// Bộ não tổng hợp của Synchro (thay Cài đặt → Bộ nhớ), liên kết thông tin theo cách của Obsidian: mỗi thứ là một ghi chú Markdown,
// ghi chú nối với nhau bằng [[liên kết]], mỗi ghi chú biết những ghi chú nào trỏ về nó (backlink) và chỗ nào nhắc tên nó mà chưa nối;
// cả mạng lưới vẽ thành đồ thị. Lưu ở máy chủ (SQLite trên VPS), xuất được thành thư mục Obsidian (.zip các tệp .md).
//
// Cấu trúc: [[Bộ não]] là trung tâm. Ba bán cầu [[Claude]] · [[ChatGPT]] · [[Gemini]] nối về trung tâm (ba hãng dùng chung một bộ não).
// Mỗi đoạn chat sau khi xong được chưng cất thành một ghi chú nhánh: tóm tắt, điều đáng nhớ, quyết định, việc dang dở, và liên kết
// tới chủ đề (ghi chú chủ đề nối về trung tâm), tên riêng, model đã nghĩ cùng, skill / connector đã dùng, các đoạn chat liên quan.
// [[Về bạn]] gom hồ sơ và ký ức dài hạn. Trung tâm được tổng hợp lại định kỳ từ tất cả: model nào cũng đọc phần tổng quan này,
// và mỗi câu hỏi kéo theo vài ghi chú liên quan nhất (tầng động của prompt).
import crypto from "node:crypto";
import { db, getUser, type UserRow } from "./authstore";
import { quickCall } from "./ai/anymodel";
import { listMemory, memCfg } from "./memory";
import { splitArtifacts } from "./artifacts";
import { vendorOf } from "./router";
import { onTick } from "./tasks";

export type NoteKind = "hub" | "about" | "model" | "chat" | "code" | "topic" | "skill" | "connector" | "note";
type Row = { id: string; user_id: string; kind: NoteKind; title: string; tkey: string; conv: string | null; body: string; props: string; created_at: number; updated_at: number };
export type Note = { id: string; kind: NoteKind; title: string; conv: string | null; body: string; props: Props; createdAt: number; updatedAt: number };
type Props = {
  tags?: string[]; date?: number; turns?: number; models?: Record<string, number>; skills?: string[]; connectors?: string[];
  gist?: string; points?: string[]; decisions?: string[]; tasks?: string[]; topics?: string[]; entities?: string[]; related?: string[];
  importance?: number; distilledAt?: number; userNote?: string; overview?: string; focus?: string[]; desc?: string; auto?: boolean;
};

export const HUB = "Bộ não", ABOUT = "Về bạn";
const HEMI: Record<string, string> = { anthropic: "Claude", openai: "ChatGPT", google: "Gemini" };
/** Ghi chú Synchro tự viết lại toàn bộ: người dùng chỉ sửa phần "Ghi chú của bạn". */
const GENERATED: NoteKind[] = ["hub", "about", "model", "chat", "code", "skill", "connector"];
const SYSTEM_NOTES: NoteKind[] = ["hub", "about", "model"];

// ---------------------------------------------------------------- lưu trữ
let ready = false;
function t() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS brain_notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, tkey TEXT NOT NULL, conv TEXT,
        body TEXT NOT NULL DEFAULT '', props TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, tkey));
      CREATE INDEX IF NOT EXISTS brain_notes_conv ON brain_notes(user_id, conv);
      CREATE TABLE IF NOT EXISTS brain_links (user_id TEXT NOT NULL, src TEXT NOT NULL, dkey TEXT NOT NULL, dtitle TEXT NOT NULL, PRIMARY KEY (src, dkey));
      CREATE INDEX IF NOT EXISTS brain_links_dst ON brain_links(user_id, dkey);
      CREATE TABLE IF NOT EXISTS brain_queue (user_id TEXT NOT NULL, conv TEXT NOT NULL, feature TEXT NOT NULL, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, conv));
      CREATE TABLE IF NOT EXISTS brain_state (user_id TEXT PRIMARY KEY, dirty INTEGER NOT NULL DEFAULT 0, hub_at INTEGER NOT NULL DEFAULT 0)`);
    ready = true;
  }
  return d;
}
/** Khóa so khớp tiêu đề: không phân biệt hoa thường, dấu, khoảng trắng (như Obsidian không phân biệt hoa thường). */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const parse = (r: Row): Note => {
  let props: Props = {};
  try { props = JSON.parse(r.props); } catch {}
  return { id: r.id, kind: r.kind, title: r.title, conv: r.conv, body: r.body, props, createdAt: r.created_at, updatedAt: r.updated_at };
};
const byKey = (uid: string, title: string) => t().prepare("SELECT * FROM brain_notes WHERE user_id = ? AND tkey = ?").get(uid, fold(title)) as Row | undefined;
const byConv = (uid: string, conv: string) => t().prepare("SELECT * FROM brain_notes WHERE user_id = ? AND conv = ?").get(uid, conv) as Row | undefined;
export const getNote = (uid: string, title: string) => { const r = byKey(uid, title); return r ? parse(r) : null; };
export const allNotes = (uid: string) => (t().prepare("SELECT * FROM brain_notes WHERE user_id = ? ORDER BY created_at").all(uid) as Row[]).map(parse);

// [[Tiêu đề]], [[Tiêu đề|chữ hiện]], [[Tiêu đề#mục]] và #thẻ (không tính tiêu đề Markdown "# ").
const LINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
export const linksIn = (body: string) => [...new Set([...body.matchAll(LINK)].map((m) => m[1].trim()).filter(Boolean))];
export const tagsIn = (body: string) => [...new Set([...body.replace(/```[\s\S]*?```/g, "").matchAll(/(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu)].map((m) => m[2].toLowerCase()))];

function index(uid: string, id: string, body: string) {
  const d = t();
  d.prepare("DELETE FROM brain_links WHERE src = ?").run(id);
  const ins = d.prepare("INSERT OR IGNORE INTO brain_links (user_id, src, dkey, dtitle) VALUES (?, ?, ?, ?)");
  for (const l of linksIn(body)) ins.run(uid, id, fold(l), l.slice(0, 200));
}
/** Tạo hoặc cập nhật một ghi chú theo tiêu đề (hoặc theo đoạn chat), rồi lập lại chỉ mục liên kết của nó. */
function put(uid: string, n: { kind: NoteKind; title: string; body: string; props?: Props; conv?: string | null; id?: string }): Note {
  const d = t(), now = Date.now();
  const cur = n.id ? (d.prepare("SELECT * FROM brain_notes WHERE id = ? AND user_id = ?").get(n.id, uid) as Row | undefined) : byKey(uid, n.title);
  const props = JSON.stringify(n.props ?? (cur ? parse(cur).props : {}));
  if (cur) {
    d.prepare("UPDATE brain_notes SET kind = ?, title = ?, tkey = ?, conv = ?, body = ?, props = ?, updated_at = ? WHERE id = ?")
      .run(n.kind, n.title, fold(n.title), n.conv ?? cur.conv, n.body, props, now, cur.id);
    index(uid, cur.id, n.body);
    return parse(d.prepare("SELECT * FROM brain_notes WHERE id = ?").get(cur.id) as Row);
  }
  const id = "bn_" + crypto.randomBytes(8).toString("base64url");
  d.prepare("INSERT INTO brain_notes (id, user_id, kind, title, tkey, conv, body, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, uid, n.kind, n.title, fold(n.title), n.conv ?? null, n.body, props, now, now);
  index(uid, id, n.body);
  return parse(d.prepare("SELECT * FROM brain_notes WHERE id = ?").get(id) as Row);
}
/** Tiêu đề chưa ai dùng (đoạn chat trùng tên chủ đề hay đoạn chat khác thì thêm ngày). */
function freeTitle(uid: string, want: string, selfId?: string, date = Date.now()) {
  const base = want.replace(/[[\]|#\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Đoạn chat";
  const taken = (s: string) => { const r = byKey(uid, s); return !!r && r.id !== selfId; };
  if (!taken(base)) return base;
  const d = new Date(date), tag = `${d.getDate()}/${d.getMonth() + 1}`;
  for (let i = 0; i < 50; i++) { const s = i ? `${base} (${tag} · ${i + 1})` : `${base} (${tag})`; if (!taken(s)) return s; }
  return `${base} ${crypto.randomBytes(2).toString("hex")}`;
}
const L = (x: string) => `[[${x}]]`;
const day = (ms: number) => { const d = new Date(ms); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };

// ---------------------------------------------------------------- ghi chú Synchro tự viết
function chatBody(p: Props): string {
  const sec = (h: string, xs?: string[], box = false) => (xs?.length ? `\n## ${h}\n${xs.map((x) => `- ${box ? "[ ] " : ""}${x}`).join("\n")}\n` : "");
  const links = [
    p.topics?.length ? `- Chủ đề: ${p.topics.map(L).join(", ")}` : "",
    p.entities?.length ? `- Nhắc tới: ${p.entities.map(L).join(", ")}` : "",
    p.related?.length ? `- Liên quan: ${p.related.map(L).join(", ")}` : "",
    hemis(p).length ? `- Bán cầu: ${hemis(p).map(L).join(" · ")}` : `- Thuộc: ${L(HUB)}`,
    p.skills?.length ? `- Skill đã dùng: ${p.skills.map((s) => L(`Skill · ${s}`)).join(", ")}` : "",
    p.connectors?.length ? `- Connector đã dùng: ${p.connectors.map((s) => L(`Connector · ${s}`)).join(", ")}` : "",
  ].filter(Boolean);
  return [
    p.gist ? `**Tóm tắt:** ${p.gist}\n` : "_Đang chưng cất đoạn chat này…_\n",
    sec("Điểm chính", p.points), sec("Đã quyết định", p.decisions), sec("Còn dang dở", p.tasks, true),
    `\n## Liên kết\n${links.join("\n")}\n`,
    p.userNote?.trim() ? `\n## Ghi chú của bạn\n${p.userNote.trim()}\n` : "",
  ].join("");
}
const hemiOf = (model: string) => HEMI[vendorOf(model)] ?? "Claude";
const hemis = (p: Props) => [...new Set(Object.keys(p.models ?? {}).map(hemiOf))];
const MODEL_INTRO: Record<string, string> = {
  Claude: "Bán cầu **Claude** của [[Bộ não]]: các đoạn chat Claude đã cùng bạn suy nghĩ.",
  ChatGPT: "Bán cầu **ChatGPT** của [[Bộ não]]: các đoạn chat ChatGPT đã cùng bạn suy nghĩ.",
  Gemini: "Bán cầu **Gemini** của [[Bộ não]]: các đoạn chat Gemini đã cùng bạn suy nghĩ.",
};

/** Trung tâm, ba bán cầu và [[Về bạn]] luôn có; [[Về bạn]] đọc lại từ hồ sơ và ký ức dài hạn mỗi lần. */
export function ensureBase(u: Pick<UserRow, "id" | "full_name" | "nickname" | "occupation">) {
  const uid = u.id;
  if (!byKey(uid, HUB)) put(uid, { kind: "hub", title: HUB, body: hubBody({}, uid), props: { auto: true, tags: ["bo-nao"] } });
  for (const name of Object.values(HEMI)) {
    const cur = getNote(uid, name);
    const models = cur?.props.models ?? {};
    const used = Object.entries(models).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k.split("/").slice(1).join("/") || k} · ${n} lượt`).join("\n");
    const body = `${MODEL_INTRO[name]} Ba bán cầu dùng chung một bộ não, nên điều ${name} học được thì các model khác cũng biết.\n${used ? `\n## Model đã dùng\n${used}\n` : ""}${cur?.props.userNote?.trim() ? `\n## Ghi chú của bạn\n${cur.props.userNote.trim()}\n` : ""}`;
    if (!cur || cur.body !== body) put(uid, { kind: "model", title: name, body, props: { ...(cur?.props ?? {}), auto: true, tags: ["model"] } });
  }
  const mem = listMemory(uid);
  const cur = getNote(uid, ABOUT);
  const who = [u.full_name && `- Tên: ${u.full_name}${u.nickname && u.nickname !== u.full_name ? ` (gọi là ${u.nickname})` : ""}`, u.occupation && `- Lĩnh vực chọn lúc tạo tài khoản: ${u.occupation}`].filter(Boolean).join("\n");
  const body = `Những điều [[Bộ não]] biết chắc về bạn: hồ sơ, phần bạn tự giới thiệu và ký ức rút ra từ các đoạn chat.\n${who ? `\n## Hồ sơ\n${who}\n` : ""}${mem.length ? `\n## Ký ức dài hạn\n${mem.map((m) => `- ${m.content}`).join("\n")}\n` : ""}${cur?.props.userNote?.trim() ? `\n## Ghi chú của bạn\n${cur.props.userNote.trim()}\n` : ""}`;
  if (!cur || cur.body !== body) put(uid, { kind: "about", title: ABOUT, body, props: { ...(cur?.props ?? {}), auto: true, tags: ["ve-ban"] } });
}

function hubBody(p: Props, uid: string): string {
  const notes = uid ? allNotes(uid) : [];
  const deg = backlinkCounts(uid);
  const topics = notes.filter((n) => n.kind === "topic").sort((a, b) => (deg.get(fold(b.title)) ?? 0) - (deg.get(fold(a.title)) ?? 0)).slice(0, 15);
  const recent = notes.filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.gist).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  return [
    "Trung tâm của mọi thứ Synchro biết về bạn: mọi đoạn chat, chủ đề, model, skill và connector đều nối về đây.\n",
    p.overview ? `\n## Tổng quan\n${p.overview}\n` : "",
    p.focus?.length ? `\n## Đang theo đuổi\n${p.focus.map((x) => `- ${x}`).join("\n")}\n` : "",
    `\n## Ba bán cầu\n${Object.values(HEMI).map(L).join(" · ")}: ba hãng model dùng chung bộ não này.\n`,
    `\n## Về bạn\n${L(ABOUT)}\n`,
    topics.length ? `\n## Chủ đề lớn\n${topics.map((n) => `- ${L(n.title)} · ${deg.get(fold(n.title)) ?? 0} liên kết`).join("\n")}\n` : "",
    recent.length ? `\n## Gần đây\n${recent.map((n) => `- ${L(n.title)}: ${n.props.gist}`).join("\n")}\n` : "",
    p.userNote?.trim() ? `\n## Ghi chú của bạn\n${p.userNote.trim()}\n` : "",
  ].join("");
}
const backlinkCounts = (uid: string) => {
  const m = new Map<string, number>();
  for (const r of t().prepare("SELECT dkey, COUNT(*) AS n FROM brain_links WHERE user_id = ? GROUP BY dkey").all(uid) as { dkey: string; n: number }[]) m.set(r.dkey, r.n);
  return m;
};
const refreshHub = (uid: string, patch: Props = {}) => {
  const cur = getNote(uid, HUB);
  const props = { ...(cur?.props ?? {}), ...patch, auto: true, tags: ["bo-nao"] };
  put(uid, { kind: "hub", title: HUB, body: hubBody(props, uid), props });
};

// ---------------------------------------------------------------- sau mỗi lượt chat
type Snap = { r: "u" | "a"; t: string }[];
const plain = (c: unknown): string => {
  const s = typeof c === "string" ? c : Array.isArray(c) ? (c as { type?: string; text?: string; name?: string }[]).map((b) => (b.type === "text" ? b.text ?? "" : b.type === "document" ? `[tệp ${b.name ?? ""}]` : b.type === "image" ? "[ảnh]" : "")).join("\n") : "";
  return splitArtifacts(s).map((sg) => (sg.kind === "text" ? sg.text : `[sản phẩm "${sg.art.title}"]`)).join("")
    .replace(/```[\s\S]*?(```|$)/g, "[khối code]").replace(/<(?:brain_recall|skill_routing|dynamic_context)>[\s\S]*?<\/(?:brain_recall|skill_routing|dynamic_context)>/g, "").replace(/#(?:tool|args)=\S+/g, "").trim();
};
const learning = (uid: string) => memCfg(uid).gen;

/**
 * Gọi sau mỗi lượt chat / Synchro Code xong (gói lẫn khóa API): ghi nhận đoạn chat vào hàng chờ chưng cất, tạo ngay ghi chú nhánh
 * (tên tạm) nối tới bán cầu của model vừa trả lời và skill / connector vừa dùng. Không học từ đoạn chat ẩn danh hoặc khi tắt học.
 */
export function afterTurn(user: UserRow, body: Record<string, unknown>, json: Record<string, unknown>) {
  if (!body.skills || body.incognito || body.feature === "artifact" || typeof json.text !== "string" || !learning(user.id)) return;
  const conv = typeof body.conv === "string" && body.conv.length <= 64 ? body.conv : null;
  if (!conv) return;
  const msgs = (Array.isArray(body.messages) ? body.messages : []) as { role?: string; content?: unknown }[];
  const snap: Snap = [...msgs.map((m) => ({ r: (m.role === "assistant" ? "a" : "u") as "u" | "a", t: plain(m.content) })), { r: "a" as const, t: plain(json.text) }]
    .filter((m) => m.t).slice(-40).map((m) => ({ ...m, t: m.t.slice(0, 1500) }));
  if (!snap.some((m) => m.r === "u")) return;
  const feature = body.feature === "code" ? "code" : "chat";
  const d = t(), now = Date.now();
  d.prepare(`INSERT INTO brain_queue (user_id, conv, feature, snapshot, updated_at, tries) VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, conv) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at, feature = excluded.feature, tries = 0`).run(user.id, conv, feature, JSON.stringify(snap), now);
  ensureBase(user);
  // Ghi chú nhánh có ngay (tên tạm từ câu đầu), nối tới bán cầu, skill, connector của lượt này.
  const model = String(json.model ?? body.model ?? "");
  const used = (Array.isArray(json.skills) ? json.skills : []) as { kind?: string; name?: string }[];
  const skills = used.filter((u) => u.kind === "skill" && u.name).map((u) => u.name!.slice(0, 60));
  const connectors = used.filter((u) => u.kind === "tool" && u.name?.includes(": ")).map((u) => u.name!.split(": ")[0].slice(0, 60));
  const cur = byConv(user.id, conv);
  const p: Props = cur ? parse(cur).props : { date: now, tags: [feature] };
  if (model) { p.models = { ...(p.models ?? {}), [model]: (p.models?.[model] ?? 0) + 1 }; bumpModel(user.id, model); }
  p.skills = [...new Set([...(p.skills ?? []), ...skills])];
  p.connectors = [...new Set([...(p.connectors ?? []), ...connectors])];
  p.turns = snap.filter((m) => m.r === "u").length;
  for (const s of skills) if (!byKey(user.id, `Skill · ${s}`)) put(user.id, { kind: "skill", title: `Skill · ${s}`, body: `Skill **${s}** của Synchro. Các đoạn chat đã dùng skill này hiện ở phần liên kết đến đây.\n\nThuộc [[Bộ não]].`, props: { tags: ["skill"], auto: true } });
  for (const s of connectors) if (!byKey(user.id, `Connector · ${s}`)) put(user.id, { kind: "connector", title: `Connector · ${s}`, body: `Connector **${s}**: nguồn dữ liệu bên ngoài Synchro đã đọc trong các đoạn chat.\n\nThuộc [[Bộ não]].`, props: { tags: ["connector"], auto: true } });
  const first = snap.find((m) => m.r === "u")!.t.split("\n")[0].slice(0, 60);
  const title = cur ? cur.title : freeTitle(user.id, first || "Đoạn chat");
  put(user.id, { id: cur?.id, kind: feature, title, conv, body: chatBody(p), props: p });
}
function bumpModel(uid: string, model: string) {
  const name = hemiOf(model), cur = getNote(uid, name);
  if (!cur) return;
  const props = { ...cur.props, models: { ...(cur.props.models ?? {}), [model]: (cur.props.models?.[model] ?? 0) + 1 } };
  t().prepare("UPDATE brain_notes SET props = ? WHERE id = ?").run(JSON.stringify(props), cur.id);
}

// ---------------------------------------------------------------- chưng cất
const DISTILL = (sens: boolean, topics: string[]) => `<brain_distill>
Bạn là phần "chưng cất" của bộ não Synchro. Đọc một đoạn chat giữa người dùng và trợ lý, giữ lại phần tinh túy nhất để làm một ghi chú trong bộ não của người dùng (giống một ghi chú Obsidian nối với các ghi chú khác bằng liên kết).
Trả về DUY NHẤT một JSON, không gì khác:
{"title":"...","gist":"...","points":["..."],"decisions":["..."],"tasks":["..."],"topics":[{"name":"...","desc":"..."}],"entities":["..."],"importance":3}
- title: 2–7 từ, nói đúng việc cụ thể của đoạn chat, cùng ngôn ngữ người dùng.
- gist: 1–3 câu: người dùng cần gì, đã làm được gì, kết luận ra sao.
- points: tối đa 5 điều đáng nhớ lâu dài (sự thật, số liệu, kết quả, kiến thức người dùng vừa học); bỏ chi tiết vụn.
- decisions: điều người dùng đã chọn hoặc chốt. tasks: việc còn dang dở hay hẹn làm tiếp. Không có thì [].
- topics: 1–3 chủ đề chung và bền (ví dụ "IELTS", "Ôn thi THPT", "Cyber security"). Nếu hợp với một chủ đề đã có thì dùng ĐÚNG tên đó để các ghi chú nối vào nhau. desc: một câu mô tả chủ đề.
- entities: tối đa 6 tên riêng quan trọng (dự án, sản phẩm, công cụ, người, nơi chốn, tài liệu), viết như tên ghi chú.
- importance: 1 = chào hỏi hay thử vu vơ, 3 = việc bình thường, 5 = quan trọng lâu dài với người dùng.
Chủ đề đã có trong bộ não: ${topics.length ? topics.join(", ") : "(chưa có)"}.${sens ? "" : "\nKhông ghi chi tiết nhạy cảm (sức khỏe, tôn giáo, chính trị, tài chính cá nhân, đời tư)."}
</brain_distill>`;
type Distilled = { title?: unknown; gist?: unknown; points?: unknown; decisions?: unknown; tasks?: unknown; topics?: unknown; entities?: unknown; importance?: unknown };
const strs = (v: unknown, n: number, len = 240) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.replace(/[[\]]/g, "").trim().slice(0, len)).slice(0, n) : []);
const cleanName = (s: string) => s.replace(/[[\]|#\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

async function distillOne(row: { user_id: string; conv: string; feature: string; snapshot: string; updated_at: number }) {
  const user = getUser(row.user_id);
  if (!user) return;
  const snap = JSON.parse(row.snapshot) as Snap;
  const uid = user.id, sens = memCfg(uid).sens;
  const notes = allNotes(uid);
  const topics = notes.filter((n) => n.kind === "topic").map((n) => n.title).slice(-60);
  const transcript = snap.map((m) => `[${m.r === "u" ? "Người dùng" : "Trợ lý"}]\n${m.t}`).join("\n\n").slice(-24_000);
  const { text } = await quickCall(user, DISTILL(sens, topics), `Đoạn chat cần chưng cất:\n\n${transcript}`, { maxTokens: 900 });
  const raw = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!raw) throw new Error("no json");
  const j = JSON.parse(raw) as Distilled;
  const cur = byConv(uid, row.conv);
  const p: Props = { ...(cur ? parse(cur).props : { date: row.updated_at, tags: [row.feature] }) };
  p.gist = typeof j.gist === "string" ? j.gist.replace(/[[\]]/g, "").trim().slice(0, 600) : p.gist;
  p.points = strs(j.points, 5); p.decisions = strs(j.decisions, 5); p.tasks = strs(j.tasks, 5);
  p.importance = Math.max(1, Math.min(5, Math.round(Number(j.importance) || 3)));
  p.distilledAt = Date.now();
  // Chủ đề: tên trùng (không phân biệt hoa thường, dấu) với chủ đề đã có thì nối vào đó; chưa có thì tạo ghi chú chủ đề nối về trung tâm.
  const tps = (Array.isArray(j.topics) ? j.topics : []).map((x) => (typeof x === "string" ? { name: x, desc: "" } : x as { name?: unknown; desc?: unknown }))
    .filter((x) => typeof x.name === "string" && cleanName(x.name)).slice(0, 3);
  p.topics = [];
  for (const tp of tps) {
    const name = cleanName(String(tp.name)), have = byKey(uid, name);
    if (have && have.kind !== "topic") { p.topics.push(have.title); continue; }
    if (!have) put(uid, { kind: "topic", title: name, body: `${typeof tp.desc === "string" && tp.desc.trim() ? tp.desc.replace(/[[\]]/g, "").trim().slice(0, 300) : `Chủ đề ${name}.`}\n\nThuộc [[Bộ não]].`, props: { tags: ["chu-de"], desc: typeof tp.desc === "string" ? tp.desc.slice(0, 300) : "" } });
    p.topics.push(have?.title ?? name);
  }
  p.entities = strs(j.entities, 6, 60).map(cleanName).filter((e) => e && !p.topics!.some((x) => fold(x) === fold(e)));
  const title = typeof j.title === "string" && cleanName(j.title) ? freeTitle(uid, cleanName(j.title), cur?.id, p.date) : cur?.title ?? freeTitle(uid, "Đoạn chat");
  // Liên quan: hai ghi chú đoạn chat gần nghĩa nhất (cùng chủ đề, cùng tên riêng, cùng từ khóa).
  const others = allNotes(uid).filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.gist && n.id !== cur?.id);
  const q = [title, p.gist, ...(p.points ?? []), ...(p.topics ?? []), ...(p.entities ?? [])].join(" ");
  p.related = rankNotes(others, q, 2, 2.2).map((n) => n.title);
  put(uid, { id: cur?.id, kind: row.feature === "code" ? "code" : "chat", title, conv: row.conv, body: chatBody(p), props: p });
  t().prepare("UPDATE brain_state SET dirty = dirty + 1 WHERE user_id = ?").run(uid);
  t().prepare("INSERT OR IGNORE INTO brain_state (user_id, dirty, hub_at) VALUES (?, 1, 0)").run(uid);
}

const CORE = `<brain_core>
Bạn là phần "tổng hợp" của bộ não Synchro. Từ mọi thứ đã biết về người dùng (hồ sơ, ký ức dài hạn, các ghi chú đoạn chat, các chủ đề), đúc kết phần trung tâm của bộ não: người dùng là ai, đang theo đuổi điều gì, đang làm những việc gì, muốn được giúp theo cách nào.
Trả về DUY NHẤT một JSON: {"overview":"3–6 câu, viết như người hiểu rõ họ, ngôi thứ ba","focus":["mục tiêu hay việc đang theo đuổi, tối đa 6"]}
Chỉ dùng điều có trong dữ liệu, không bịa. Điều mới hơn đúng hơn điều cũ.
</brain_core>`;
/** Tổng hợp lại trung tâm từ hồ sơ, ký ức, chủ đề và các nhánh mới nhất. */
async function consolidate(uid: string) {
  const user = getUser(uid);
  if (!user) return;
  ensureBase(user);
  const notes = allNotes(uid);
  const chats = notes.filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.gist).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 25);
  const data = [
    `Hồ sơ: ${[user.full_name, user.nickname && `gọi là ${user.nickname}`, user.occupation].filter(Boolean).join(", ") || "(trống)"}`,
    user.instructions ? `Người dùng tự giới thiệu:\n${user.instructions.slice(0, 6000)}` : "",
    `Ký ức dài hạn:\n${listMemory(uid).map((m) => `- ${m.content}`).join("\n") || "(trống)"}`,
    `Chủ đề: ${notes.filter((n) => n.kind === "topic").map((n) => n.title).join(", ") || "(chưa có)"}`,
    `Các đoạn chat gần đây (mới trước):\n${chats.map((n) => `- ${day(n.updatedAt)} ${n.title}: ${n.props.gist}${n.props.tasks?.length ? ` Dang dở: ${n.props.tasks.join("; ")}` : ""}`).join("\n") || "(chưa có)"}`,
  ].filter(Boolean).join("\n\n");
  const { text } = await quickCall(user, CORE, data, { maxTokens: 700 });
  const raw = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!raw) throw new Error("no json");
  const j = JSON.parse(raw) as { overview?: unknown; focus?: unknown };
  refreshHub(uid, { overview: typeof j.overview === "string" ? j.overview.replace(/[[\]]/g, "").trim().slice(0, 1500) : undefined, focus: strs(j.focus, 6) });
  t().prepare("INSERT INTO brain_state (user_id, dirty, hub_at) VALUES (?, 0, ?) ON CONFLICT(user_id) DO UPDATE SET dirty = 0, hub_at = excluded.hub_at").run(uid, Date.now());
}

const IDLE = Number(process.env.SYNCHRO_BRAIN_IDLE_MS) || 45_000;
const g = globalThis as unknown as { __brainBusy?: boolean };
/**
 * Chưng cất các đoạn chat đã ngừng một lúc (mặc định 45 giây sau lượt cuối) và tổng hợp lại trung tâm khi có từ 3 nhánh mới
 * (hoặc sau 6 giờ). now: chạy ngay cho một người (nút "Chưng cất ngay", kiểm thử).
 */
export async function distillPending(o: { uid?: string; now?: boolean; max?: number } = {}) {
  if (g.__brainBusy) return 0;
  g.__brainBusy = true;
  let done = 0;
  try {
    const d = t(), cut = o.now ? Date.now() + 1 : Date.now() - IDLE;
    const rows = (o.uid ? d.prepare("SELECT * FROM brain_queue WHERE user_id = ? AND updated_at < ? ORDER BY updated_at LIMIT ?").all(o.uid, cut, o.max ?? 20)
      : d.prepare("SELECT * FROM brain_queue WHERE updated_at < ? ORDER BY updated_at LIMIT ?").all(cut, o.max ?? 3)) as { user_id: string; conv: string; feature: string; snapshot: string; updated_at: number; tries: number }[];
    for (const r of rows) {
      try {
        await distillOne(r);
        d.prepare("DELETE FROM brain_queue WHERE user_id = ? AND conv = ? AND updated_at = ?").run(r.user_id, r.conv, r.updated_at);
        done++;
      } catch (e) {
        // Model trả sai hoặc chưa dùng được: thử lại ở lượt sau, quá 3 lần thì bỏ (ghi chú nhánh vẫn còn với tên tạm).
        if (r.tries >= 2) d.prepare("DELETE FROM brain_queue WHERE user_id = ? AND conv = ?").run(r.user_id, r.conv);
        else d.prepare("UPDATE brain_queue SET tries = tries + 1 WHERE user_id = ? AND conv = ?").run(r.user_id, r.conv);
        if (!/no json|503/.test(String((e as Error).message))) console.error("[brain]", (e as Error).message);
      }
    }
    const users = o.uid ? [o.uid] : [...new Set(rows.map((r) => r.user_id))];
    for (const uid of users) {
      const st = d.prepare("SELECT dirty, hub_at FROM brain_state WHERE user_id = ?").get(uid) as { dirty: number; hub_at: number } | undefined;
      if (st && st.dirty > 0 && (o.now || st.dirty >= 3 || Date.now() - st.hub_at > 6 * 3600_000)) await consolidate(uid).catch((e) => console.error("[brain] tổng hợp", (e as Error).message));
      else refreshHub(uid);
    }
  } finally { g.__brainBusy = false; }
  return done;
}
onTick("brain", () => { void distillPending().catch((e) => console.error("[brain]", e)); });

/** Nạp các đoạn chat cũ (đang nằm trong trình duyệt) vào hàng chờ chưng cất. */
export function importChats(user: UserRow, chats: { id: string; title?: string; msgs: { role: string; text: string }[] }[]) {
  const d = t();
  let n = 0;
  ensureBase(user);
  for (const c of chats.slice(0, 50)) {
    const conv = String(c.id).slice(0, 64);
    const ex = conv ? byConv(user.id, conv) : undefined;
    if (!conv || (ex && parse(ex).props.distilledAt)) continue;
    const snap: Snap = c.msgs.map((m) => ({ r: (m.role === "ai" || m.role === "assistant" ? "a" : "u") as "u" | "a", t: plain(m.text) })).filter((m) => m.t).slice(-40).map((m) => ({ ...m, t: m.t.slice(0, 1500) }));
    if (snap.filter((m) => m.r === "u").map((m) => m.t).join(" ").length < 12) continue;
    d.prepare(`INSERT INTO brain_queue (user_id, conv, feature, snapshot, updated_at, tries) VALUES (?, ?, 'chat', ?, ?, 0)
      ON CONFLICT(user_id, conv) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at, tries = 0`).run(user.id, conv, JSON.stringify(snap), Date.now() - IDLE - 1);
    if (!ex) put(user.id, { kind: "chat", title: freeTitle(user.id, (c.title || snap[0].t).slice(0, 60)), conv, body: chatBody({ tags: ["chat"] }), props: { date: Date.now(), tags: ["chat"], turns: snap.filter((m) => m.r === "u").length } });
    n++;
  }
  return n;
}
export const pendingCount = (uid: string) => (t().prepare("SELECT COUNT(*) AS n FROM brain_queue WHERE user_id = ?").get(uid) as { n: number }).n;

// ---------------------------------------------------------------- tìm kiếm (BM25 trên tiêu đề, nội dung, chủ đề)
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
function rankNotes(notes: Note[], query: string, k: number, min = 1.2): Note[] {
  const q = [...new Set(words(query))];
  if (!q.length || !notes.length) return [];
  const docs = notes.map((n) => [...words(n.title), ...words(n.title), ...words(n.body)]);
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  return docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) { const f = tf.get(w); if (!f) continue; const n = df.get(w) ?? 0; s += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / avg)); }
    return { n: notes[i], s };
  }).filter((x) => x.s >= min).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.n);
}
export const searchNotes = (uid: string, query: string, k = 20) => rankNotes(allNotes(uid), query, k, 0.3);

// ---------------------------------------------------------------- dùng trong lượt chat
/** Phần trung tâm cho lời nhắc hệ thống (tầng tĩnh): tổng quan và những gì người dùng đang theo đuổi. */
export function brainCore(uid: string): string {
  const hub = getNote(uid, HUB);
  if (!hub?.props.overview && !hub?.props.focus?.length) return "";
  return `${hub.props.overview ? `Tổng quan bạn đã đúc kết về họ: ${hub.props.overview}` : ""}${hub.props.focus?.length ? `\nHọ đang theo đuổi: ${hub.props.focus.join("; ")}.` : ""}`.trim();
}
/** Vài ghi chú trong bộ não liên quan nhất tới câu hỏi (tầng động, cuối prompt). */
export function brainRecall(uid: string, query: string, conv?: string): string {
  if (!query.trim() || !learning(uid)) return "";
  const notes = allNotes(uid).filter((n) => (n.kind === "chat" || n.kind === "code" || n.kind === "topic" || n.kind === "note") && n.conv !== conv && (n.kind !== "chat" && n.kind !== "code" || n.props.gist));
  const hits = rankNotes(notes, query, 3, 1.6);
  if (!hits.length) return "";
  const line = (n: Note) => n.kind === "topic" || n.kind === "note"
    ? `- [[${n.title}]] (chủ đề): ${n.body.replace(/\n+/g, " ").replace(/\[\[|\]\]/g, "").slice(0, 300)}`
    : `- [[${n.title}]] (${day(n.props.date ?? n.createdAt)}): ${n.props.gist}${n.props.points?.length ? ` Điểm chính: ${n.props.points.slice(0, 3).join("; ")}.` : ""}${n.props.tasks?.length ? ` Còn dang dở: ${n.props.tasks.slice(0, 2).join("; ")}.` : ""}`;
  return `<brain_recall>
Từ bộ não chung của Synchro, những ghi chú liên quan tới câu hỏi này (bạn nhớ chúng như chuyện đã cùng người dùng trải qua; dùng khi hữu ích, không cần nói là đang nhớ lại):
${hits.map(line).join("\n")}
</brain_recall>`;
}

// ---------------------------------------------------------------- xem và sửa (Cài đặt → Bộ não)
export type GraphNode = { id: string; title: string; kind: NoteKind | "ghost"; tags: string[]; created: number; links: number };
export function brainGraph(user: UserRow) {
  ensureBase(user);
  const uid = user.id, notes = allNotes(uid);
  const byK = new Map(notes.map((n) => [fold(n.title), n]));
  const links = t().prepare("SELECT src, dkey, dtitle FROM brain_links WHERE user_id = ?").all(uid) as { src: string; dkey: string; dtitle: string }[];
  const ghosts = new Map<string, GraphNode>();
  const edges: { s: string; t: string }[] = [];
  const deg = new Map<string, number>();
  for (const l of links) {
    const dst = byK.get(l.dkey);
    let to = dst?.id;
    if (!to) { to = `ghost:${l.dkey}`; if (!ghosts.has(to)) ghosts.set(to, { id: to, title: l.dtitle, kind: "ghost", tags: [], created: Date.now(), links: 0 }); }
    edges.push({ s: l.src, t: to });
    deg.set(to, (deg.get(to) ?? 0) + 1); deg.set(l.src, (deg.get(l.src) ?? 0) + 1);
  }
  const nodes: GraphNode[] = [...notes.map((n) => ({ id: n.id, title: n.title, kind: n.kind, tags: [...new Set([...(n.props.tags ?? []), ...tagsIn(n.body)])], created: n.createdAt, links: deg.get(n.id) ?? 0 })), ...[...ghosts.values()].map((x) => ({ ...x, links: deg.get(x.id) ?? 0 }))];
  return { nodes, edges, stats: { notes: notes.length, links: edges.length, chats: notes.filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.distilledAt).length, topics: notes.filter((n) => n.kind === "topic").length, pending: pendingCount(uid), memories: listMemory(uid).length } };
}
/** Một ghi chú kèm liên kết đi (có / chưa có ghi chú), liên kết đến đây và chỗ nhắc tên mà chưa nối (như Obsidian). */
export function brainNote(user: UserRow, title: string) {
  ensureBase(user);
  const uid = user.id, n = getNote(uid, title);
  if (!n) return null;
  const notes = allNotes(uid), byK = new Map(notes.map((x) => [fold(x.title), x]));
  const out = linksIn(n.body).map((l) => ({ title: byK.get(fold(l))?.title ?? l, exists: byK.has(fold(l)) }));
  const srcs = t().prepare("SELECT DISTINCT src FROM brain_links WHERE user_id = ? AND dkey = ?").all(uid, fold(n.title)) as { src: string }[];
  const around = (body: string, needle: string) => {
    const line = body.split("\n").find((l) => fold(l).includes(fold(needle))) ?? "";
    return line.replace(/^[-*#\s]+/, "").slice(0, 220);
  };
  const back = srcs.map((s) => notes.find((x) => x.id === s.src)).filter((x): x is Note => !!x).map((x) => ({ title: x.title, kind: x.kind, context: around(x.body, `[[${n.title}`) || around(x.body, n.title) }));
  const linked = new Set(back.map((b) => b.title));
  const unlinked = n.title.length < 3 ? [] : notes.filter((x) => x.id !== n.id && !linked.has(x.title) && fold(x.body.replace(LINK, " ")).includes(fold(n.title)))
    .slice(0, 20).map((x) => ({ title: x.title, kind: x.kind, context: around(x.body.replace(LINK, (m, a, b) => b || a), n.title) }));
  return { note: { ...n, editable: !SYSTEM_NOTES.includes(n.kind), generated: GENERATED.includes(n.kind), tags: [...new Set([...(n.props.tags ?? []), ...tagsIn(n.body)])] }, outgoing: out, backlinks: back, unlinked };
}
/** Sửa ghi chú: ghi chú Synchro tự viết thì chỉ sửa phần "Ghi chú của bạn"; ghi chú chủ đề / ghi chú riêng thì sửa cả nội dung. */
export function saveNote(user: UserRow, title: string, patch: { body?: string; userNote?: string; newTitle?: string }) {
  const n = getNote(user.id, title);
  if (!n) {
    const name = cleanName(patch.newTitle ?? title);
    if (!name) throw new Error("Ghi chú cần có tên.");
    return put(user.id, { kind: "note", title: freeTitle(user.id, name), body: (patch.body ?? "").slice(0, 50_000), props: { tags: ["ghi-chu"] } });
  }
  if (GENERATED.includes(n.kind)) {
    const props = { ...n.props, userNote: (patch.userNote ?? "").slice(0, 20_000) };
    const body = n.kind === "chat" || n.kind === "code" ? chatBody(props) : n.kind === "hub" ? hubBody(props, user.id) : n.body.replace(/\n## Ghi chú của bạn\n[\s\S]*$/, "") + (props.userNote.trim() ? `\n## Ghi chú của bạn\n${props.userNote.trim()}\n` : "");
    return put(user.id, { id: n.id, kind: n.kind, title: n.title, body, props });
  }
  const newTitle = patch.newTitle ? freeTitle(user.id, cleanName(patch.newTitle), n.id) : n.title;
  return put(user.id, { id: n.id, kind: n.kind, title: newTitle, body: (patch.body ?? n.body).slice(0, 50_000), props: n.props });
}
export function deleteNote(user: UserRow, title: string) {
  const n = getNote(user.id, title);
  if (!n || SYSTEM_NOTES.includes(n.kind)) return false;
  t().prepare("DELETE FROM brain_links WHERE src = ?").run(n.id);
  t().prepare("DELETE FROM brain_notes WHERE id = ?").run(n.id);
  if (n.conv) t().prepare("DELETE FROM brain_queue WHERE user_id = ? AND conv = ?").run(user.id, n.conv);
  return true;
}
export function wipeBrain(uid: string) {
  const d = t();
  d.prepare("DELETE FROM brain_links WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM brain_notes WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM brain_queue WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM brain_state WHERE user_id = ?").run(uid);
}

// ---------------------------------------------------------------- xuất thành thư mục Obsidian
const FOLDER: Record<NoteKind, string> = { hub: "", about: "", model: "Bán cầu", chat: "Đoạn chat", code: "Synchro Code", topic: "Chủ đề", skill: "Skill", connector: "Connector", note: "Ghi chú" };
export async function exportVault(user: UserRow): Promise<ArrayBuffer> {
  ensureBase(user);
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip(), root = zip.folder("Bộ não Synchro")!;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
  for (const n of allNotes(user.id)) {
    const fm = [`kind: ${n.kind}`, `created: ${new Date(n.createdAt).toISOString()}`, `updated: ${new Date(n.updatedAt).toISOString()}`,
      n.props.tags?.length ? `tags: [${n.props.tags.join(", ")}]` : "", n.props.importance ? `importance: ${n.props.importance}` : "",
      n.props.models ? `models: [${Object.keys(n.props.models).join(", ")}]` : ""].filter(Boolean).join("\n");
    const dir = FOLDER[n.kind];
    root.file(`${dir ? `${dir}/` : ""}${safe(n.title)}.md`, `---\n${fm}\n---\n# ${n.title}\n\n${n.body}`);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}
