// Tệp do code của model tạo ra (outputs/ của mỗi lần run_code): lưu trên đĩa máy chủ theo tài khoản, tải về qua
// /api/outputs/<id>. Chỉ chủ tài khoản tải được; tệp tự xóa sau 30 ngày.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db } from "./authstore";
import { randomToken } from "./mcpauth";
import type { RunFile } from "./coderun";

export type OutFile = { id: string; name: string; size: number; mime: string };
const TTL = 30 * 86_400_000;
const ROOT = path.join(DATA_DIR, "outputs");

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf", csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain", md: "text/markdown", json: "application/json",
  html: "text/html", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", py: "text/x-python", js: "text/javascript", ts: "text/plain", sql: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  zip: "application/zip", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4",
};
export const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS outputs_user ON outputs(user_id, created_at)`);
    ready = true;
    sweep();
  }
  return d;
}

function sweep() {
  const d = db();
  const old = d.prepare("SELECT id, user_id FROM outputs WHERE created_at < ?").all(Date.now() - TTL) as { id: string; user_id: string }[];
  for (const o of old) fs.rmSync(path.join(ROOT, o.user_id, o.id), { force: true });
  d.prepare("DELETE FROM outputs WHERE created_at < ?").run(Date.now() - TTL);
}

const safeName = (p: string) => (path.basename(p).replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").slice(0, 120) || "tep");

export function saveOutputs(uid: string, files: RunFile[]): OutFile[] {
  const d = init();
  if (!files.length) return [];
  fs.mkdirSync(path.join(ROOT, uid), { recursive: true, mode: 0o700 });
  return files.map((f) => {
    const id = randomToken(12);
    const name = safeName(f.path);
    fs.writeFileSync(path.join(ROOT, uid, id), f.data, { mode: 0o600 });
    const o = { id, name, size: f.data.length, mime: mimeOf(name) };
    d.prepare("INSERT INTO outputs (id, user_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, uid, name, o.mime, o.size, Date.now());
    return o;
  });
}

export function readOutput(uid: string, id: string): (OutFile & { data: Buffer }) | null {
  if (!/^[\w-]{8,40}$/.test(id)) return null;
  const r = init().prepare("SELECT id, name, mime, size, created_at FROM outputs WHERE id = ? AND user_id = ?").get(id, uid) as (OutFile & { created_at: number }) | undefined;
  if (!r || Date.now() - r.created_at > TTL) return null;
  const p = path.join(ROOT, uid, id);
  if (!fs.existsSync(p)) return null;
  return { id: r.id, name: r.name, mime: r.mime, size: r.size, data: fs.readFileSync(p) };
}

