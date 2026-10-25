// Artifact của từng tài khoản (chỉ chạy ở máy chủ): mỗi artifact (theo cuộc trò chuyện + identifier) giữ mọi phiên bản
// model đã viết, để trang Artifacts liệt kê và mở lại được trên mọi thiết bị. Chỉ chủ tài khoản xem được.
import { db } from "./authstore";
import { randomToken } from "./mcpauth";
import { ART_TYPES, type ArtType } from "./artifacts";

export type ArtVersion = { content: string; at: number };
export type ArtRow = { id: string; conv: string; ident: string; title: string; type: ArtType; lang: string | null; versions: ArtVersion[]; created_at: number; updated_at: number };
export type ArtSummary = Omit<ArtRow, "versions"> & { count: number; preview: string };
export const ART_LIMITS = { content: 400_000, versions: 50, perUser: 500 };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT NOT NULL, ident TEXT NOT NULL, title TEXT NOT NULL,
      type TEXT NOT NULL, lang TEXT, versions TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, conv, ident));
      CREATE INDEX IF NOT EXISTS artifacts_user ON artifacts(user_id, updated_at)`);
    ready = true;
  }
  return d;
}

type Raw = Omit<ArtRow, "versions"> & { versions: string };
const parse = (r: Raw): ArtRow => ({ ...r, versions: JSON.parse(r.versions) as ArtVersion[] });

export function listArtifacts(uid: string): ArtSummary[] {
  const rows = init().prepare("SELECT * FROM artifacts WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(uid, ART_LIMITS.perUser) as (Raw & { user_id?: string })[];
  return rows.map((r) => {
    const a = parse(r);
    const last = a.versions[a.versions.length - 1]?.content ?? "";
    return { id: a.id, conv: a.conv, ident: a.ident, title: a.title, type: a.type, lang: a.lang, created_at: a.created_at, updated_at: a.updated_at, count: a.versions.length, preview: last.slice(0, 6000) };
  });
}

export function getArtifact(uid: string, id: string): ArtRow | null {
  const r = init().prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?").get(id, uid) as Raw | undefined;
  return r ? parse(r) : null;
}

export type ArtInput = { ident: string; title: string; type: ArtType; lang?: string | null; content: string };
export function validArt(x: unknown): ArtInput | null {
  const o = x as Partial<ArtInput>;
  if (!o || typeof o !== "object") return null;
  if (typeof o.ident !== "string" || !/^[\w.-]{1,80}$/.test(o.ident)) return null;
  if (typeof o.title !== "string" || !o.title.trim() || o.title.length > 200) return null;
  if (typeof o.type !== "string" || !(ART_TYPES as readonly string[]).includes(o.type)) return null;
  if (typeof o.content !== "string" || !o.content.trim() || o.content.length > ART_LIMITS.content) return null;
  const lang = typeof o.lang === "string" && /^[\w+#.-]{1,30}$/.test(o.lang) ? o.lang : null;
  return { ident: o.ident, title: o.title.trim(), type: o.type as ArtType, lang, content: o.content };
}

// Thêm phiên bản mới (bỏ qua nếu giống hệt phiên bản cuối). Trả về id artifact.
export function saveArtifact(uid: string, conv: string, a: ArtInput): string {
  const d = init();
  const now = Date.now();
  const r = d.prepare("SELECT * FROM artifacts WHERE user_id = ? AND conv = ? AND ident = ?").get(uid, conv, a.ident) as Raw | undefined;
  if (r) {
    const cur = parse(r);
    if (cur.versions[cur.versions.length - 1]?.content !== a.content) cur.versions.push({ content: a.content, at: now });
    const versions = cur.versions.slice(-ART_LIMITS.versions);
    d.prepare("UPDATE artifacts SET title = ?, type = ?, lang = ?, versions = ?, updated_at = ? WHERE id = ?").run(a.title, a.type, a.lang ?? null, JSON.stringify(versions), now, cur.id);
    return cur.id;
  }
  const n = (d.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE user_id = ?").get(uid) as { n: number }).n;
  if (n >= ART_LIMITS.perUser) {
    const old = d.prepare("SELECT id FROM artifacts WHERE user_id = ? ORDER BY updated_at ASC LIMIT 1").get(uid) as { id: string } | undefined;
    if (old) d.prepare("DELETE FROM artifacts WHERE id = ?").run(old.id);
  }
  const id = randomToken(12);
  d.prepare("INSERT INTO artifacts (id, user_id, conv, ident, title, type, lang, versions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, uid, conv, a.ident, a.title, a.type, a.lang ?? null, JSON.stringify([{ content: a.content, at: now }]), now, now);
  return id;
}

export function deleteArtifact(uid: string, id: string) {
  return init().prepare("DELETE FROM artifacts WHERE id = ? AND user_id = ?").run(id, uid).changes > 0;
}
export function removeUserArtifacts(uid: string) {
  init().prepare("DELETE FROM artifacts WHERE user_id = ?").run(uid);
}
