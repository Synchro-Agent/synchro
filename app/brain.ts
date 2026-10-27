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

export type NoteKind = "hub" | "about" | "model" | "chat" | "code" | "topic" | "skill" | "connector" | "note" | "daily";
type Row = { id: string; user_id: string; kind: NoteKind; title: string; tkey: string; conv: string | null; body: string; props: string; created_at: number; updated_at: number };
export type Note = { id: string; kind: NoteKind; title: string; conv: string | null; body: string; props: Props; createdAt: number; updatedAt: number };
type Props = {
  tags?: string[]; date?: number; turns?: number; models?: Record<string, number>; skills?: string[]; connectors?: string[];
  gist?: string; points?: string[]; decisions?: string[]; tasks?: string[]; topics?: string[]; entities?: string[]; related?: string[];
  importance?: number; distilledAt?: number; userNote?: string; overview?: string; focus?: string[]; desc?: string; auto?: boolean;
  /** Tên khác của ghi chú (như aliases của Obsidian): liên kết và chỗ nhắc tên đều nhận. */ aliases?: string[];
  /** Việc đã xong (Bases → Việc dang dở). */ done?: string[]; pinned?: boolean; day?: string;
};

export const HUB = "Bộ não", ABOUT = "Về bạn";
const HEMI: Record<string, string> = { anthropic: "Claude", openai: "ChatGPT", google: "Gemini" };
/** Ghi chú Synchro tự viết lại toàn bộ: người dùng chỉ sửa phần "Ghi chú của bạn". */
const GENERATED: NoteKind[] = ["hub", "about", "model", "chat", "code", "skill", "connector", "daily"];
const SYSTEM_NOTES: NoteKind[] = ["hub", "about", "model", "daily"];

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
  const done = new Set((p.done ?? []).map(fold));
  const sec = (h: string, xs?: string[], box = false) => (xs?.length ? `\n## ${h}\n${xs.map((x) => `- ${box ? (done.has(fold(x)) ? "[x] " : "[ ] ") : ""}${x}`).join("\n")}\n` : "");
  const links = [
    p.topics?.length ? `- Chủ đề: ${p.topics.map(L).join(", ")}` : "",
    p.entities?.length ? `- Nhắc tới: ${p.entities.map(L).join(", ")}` : "",
    p.related?.length ? `- Liên quan: ${p.related.map(L).join(", ")}` : "",
    hemis(p).length ? `- Bán cầu: ${hemis(p).map(L).join(" · ")}` : `- Thuộc: ${L(HUB)}`,
    p.skills?.length ? `- Skill đã dùng: ${p.skills.map((s) => L(`Skill · ${s}`)).join(", ")}` : "",
    p.connectors?.length ? `- Connector đã dùng: ${p.connectors.map((s) => L(`Connector · ${s}`)).join(", ")}` : "",
    p.distilledAt && p.date ? `- Ngày: ${L(dailyTitle(p.date))}` : "",
  ].filter(Boolean);
  return [
    p.gist ? `**Tóm tắt:** ${p.gist}\n` : "_Đang chưng cất đoạn chat này…_\n",
    sec("Điểm chính", p.points), sec("Đã quyết định", p.decisions), sec("Còn dang dở", p.tasks, true),
    `\n## Liên kết\n${links.join("\n")}\n`,
    p.userNote?.trim() ? `\n## Ghi chú của bạn\n${p.userNote.trim()}\n` : "",
  ].join("");
}
const hemiOf = (model: string) => HEMI[vendorOf(model)] ?? "Claude";
/** Ghi chú hằng ngày (Daily notes của Obsidian): trục thời gian của bộ não. */
const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const dailyTitle = (ms: number) => `Nhật ký ${dayKey(ms)}`;
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
{"title":"...","gist":"...","points":["..."],"decisions":["..."],"tasks":["..."],"topics":[{"name":"...","desc":"...","aliases":["..."]}],"entities":["..."],"importance":3}
- title: 2–7 từ, nói đúng việc cụ thể của đoạn chat, cùng ngôn ngữ người dùng.
- gist: 1–3 câu: người dùng cần gì, đã làm được gì, kết luận ra sao.
- points: tối đa 5 điều đáng nhớ lâu dài (sự thật, số liệu, kết quả, kiến thức người dùng vừa học); bỏ chi tiết vụn.
- decisions: điều người dùng đã chọn hoặc chốt. tasks: việc còn dang dở hay hẹn làm tiếp. Không có thì [].
- topics: 1–3 chủ đề chung và bền (ví dụ "IELTS", "Ôn thi THPT", "Cyber security"). Nếu hợp với một chủ đề đã có thì dùng ĐÚNG tên đó để các ghi chú nối vào nhau. desc: một câu mô tả chủ đề. aliases: tên khác hay viết tắt của chủ đề (ví dụ "An ninh mạng" cho "Cyber security"), có thể để [].
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
    const name = cleanName(String(tp.name)), have0 = byKey(uid, name);
    const viaAlias = !have0 ? resolver(allNotes(uid)).get(fold(name)) : undefined;
    if (viaAlias) { p.topics.push(viaAlias.title); continue; }
    const have = have0;
    if (have && have.kind !== "topic") { p.topics.push(have.title); continue; }
    const al = strs((tp as { aliases?: unknown }).aliases, 5, 60).map(cleanName).filter((a) => a && fold(a) !== fold(name) && !byKey(uid, a));
    if (!have) put(uid, { kind: "topic", title: name, body: `${typeof tp.desc === "string" && tp.desc.trim() ? tp.desc.replace(/[[\]]/g, "").trim().slice(0, 300) : `Chủ đề ${name}.`}\n\nThuộc [[Bộ não]].`, props: { tags: ["chu-de"], desc: typeof tp.desc === "string" ? tp.desc.slice(0, 300) : "", aliases: al } });
    p.topics.push(have?.title ?? name);
  }
  p.entities = strs(j.entities, 6, 60).map(cleanName).filter((e) => e && !p.topics!.some((x) => fold(x) === fold(e)));
  const title = typeof j.title === "string" && cleanName(j.title) ? freeTitle(uid, cleanName(j.title), cur?.id, p.date) : cur?.title ?? freeTitle(uid, "Đoạn chat");
  // Liên quan: hai ghi chú đoạn chat gần nghĩa nhất (cùng chủ đề, cùng tên riêng, cùng từ khóa).
  const others = allNotes(uid).filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.gist && n.id !== cur?.id);
  const q = [title, p.gist, ...(p.points ?? []), ...(p.topics ?? []), ...(p.entities ?? [])].join(" ");
  p.related = rankNotes(others, q, 2, 2.2).map((n) => n.title);
  put(uid, { id: cur?.id, kind: row.feature === "code" ? "code" : "chat", title, conv: row.conv, body: chatBody(p), props: p });
  refreshDaily(uid, p.date ?? row.updated_at);
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

// ---------------------------------------------------------------- tên và bí danh
/** Tên → ghi chú, gồm cả bí danh (liên kết [[bí danh]] trỏ đúng ghi chú, như Obsidian). */
function resolver(notes: Note[]) {
  const m = new Map<string, Note>();
  for (const n of notes) m.set(fold(n.title), n);
  for (const n of notes) for (const a of n.props.aliases ?? []) { const k = fold(a); if (k && !m.has(k)) m.set(k, n); }
  return m;
}
const namesOf = (n: Note) => [n.title, ...(n.props.aliases ?? [])].filter((x) => x.trim().length >= 2);
/** Tìm ghi chú theo tên hoặc bí danh. */
export function findNote(uid: string, name: string): Note | null { return getNote(uid, name) ?? resolver(allNotes(uid)).get(fold(name)) ?? null; }
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Thay mọi [[Cũ…]] bằng [[Mới…]] (giữ #mục và |chữ hiện). */
const swapLinks = (body: string, from: string, to: string) => body.replace(new RegExp(`\\[\\[\\s*${esc(from)}\\s*((?:#[^\\]|\\n]*)?(?:\\|[^\\]\\n]*)?)\\]\\]`, "giu"), (_m, rest) => `[[${to}${rest}]]`);

/** Đổi tên ghi chú: mọi liên kết tới nó ở các ghi chú khác tự đổi theo (như Obsidian). */
function relink(user: UserRow, from: string, to: string) {
  const uid = user.id, k = fold(from);
  const srcs = new Set((t().prepare("SELECT src FROM brain_links WHERE user_id = ? AND dkey = ?").all(uid, k) as { src: string }[]).map((r) => r.src));
  for (const n of allNotes(uid)) {
    const inProps = [...(n.props.topics ?? []), ...(n.props.entities ?? []), ...(n.props.related ?? [])].some((x) => fold(x) === k);
    if (!srcs.has(n.id) && !inProps) continue;
    const swap = (xs?: string[]) => xs?.map((x) => (fold(x) === k ? to : x));
    if (n.kind === "chat" || n.kind === "code") {
      const props = { ...n.props, topics: swap(n.props.topics), entities: swap(n.props.entities), related: swap(n.props.related), userNote: n.props.userNote ? swapLinks(n.props.userNote, from, to) : n.props.userNote };
      put(uid, { id: n.id, kind: n.kind, title: n.title, conv: n.conv, body: chatBody(props), props });
    } else if (!GENERATED.includes(n.kind)) put(uid, { id: n.id, kind: n.kind, title: n.title, body: swapLinks(n.body, from, to), props: n.props });
    else if (n.props.userNote) { const props = { ...n.props, userNote: swapLinks(n.props.userNote, from, to) }; put(uid, { id: n.id, kind: n.kind, title: n.title, body: swapLinks(n.body, from, to), props }); }
  }
  // Nhật ký và trung tâm viết lại từ các nhánh (đã đổi tên ở trên).
  for (const n of allNotes(uid)) if (n.kind === "daily" && n.props.date) refreshDaily(uid, n.props.date);
  refreshHub(uid);
}

/** Gộp ghi chú (Note composer của Obsidian): nội dung nối vào ghi chú đích, tên cũ thành bí danh, mọi liên kết trỏ về ghi chú đích. */
export function mergeNotes(user: UserRow, from: string, into: string) {
  const a = findNote(user.id, from), b = findNote(user.id, into);
  if (!a || !b || a.id === b.id) throw new Error("Chọn hai ghi chú khác nhau để gộp.");
  if (!["topic", "note"].includes(a.kind) || !["topic", "note"].includes(b.kind)) throw new Error("Chỉ gộp được ghi chú chủ đề và ghi chú riêng.");
  const body = `${b.body.trimEnd()}\n\n## Gộp từ ${a.title}\n${a.body.replace(/\n?Thuộc \[\[Bộ não\]\]\.?\s*$/, "").trim()}\n`;
  const aliases = [...new Set([...(b.props.aliases ?? []), a.title, ...(a.props.aliases ?? [])])].filter((x) => fold(x) !== fold(b.title));
  put(user.id, { id: b.id, kind: b.kind, title: b.title, body, props: { ...b.props, aliases, tags: [...new Set([...(b.props.tags ?? []), ...(a.props.tags ?? [])])] } });
  t().prepare("DELETE FROM brain_links WHERE src = ?").run(a.id);
  t().prepare("DELETE FROM brain_notes WHERE id = ?").run(a.id);
  relink(user, a.title, b.title);
  return getNote(user.id, b.title)!;
}

/** Nối một chỗ nhắc tên thành liên kết: ghi chú nguồn sửa được thì thay chữ đầu tiên bằng [[Tên]]; nhánh đoạn chat thì thêm vào "Nhắc tới". */
export function linkMention(user: UserRow, source: string, target: string) {
  const src = findNote(user.id, source), dst = findNote(user.id, target);
  if (!src || !dst) throw new Error("Không tìm thấy ghi chú.");
  if (src.kind === "chat" || src.kind === "code") {
    const props = { ...src.props, entities: [...new Set([...(src.props.entities ?? []), dst.title])] };
    return put(user.id, { id: src.id, kind: src.kind, title: src.title, conv: src.conv, body: chatBody(props), props });
  }
  if (GENERATED.includes(src.kind)) throw new Error("Ghi chú này do Synchro tự viết; hãy thêm liên kết ở phần “Ghi chú của bạn”.");
  for (const name of namesOf(dst)) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}\\[])(${esc(name)})(?=$|[^\\p{L}\\p{N}\\]])`, "iu");
    const plainBody = src.body.replace(LINK, (m0) => "\u0000".repeat(m0.length));
    const m = re.exec(plainBody);
    if (!m) continue;
    const at = m.index + m[1].length, word = src.body.slice(at, at + m[2].length);
    const link = word === dst.title ? `[[${dst.title}]]` : `[[${dst.title}|${word}]]`;
    return put(user.id, { id: src.id, kind: src.kind, title: src.title, body: src.body.slice(0, at) + link + src.body.slice(at + m[2].length), props: src.props });
  }
  throw new Error("Không còn chỗ nhắc tên nào chưa nối.");
}

// ---------------------------------------------------------------- thẻ, tìm kiếm có toán tử, bảng (Bases)
const tagsOf = (n: Note) => [...new Set([...(n.props.tags ?? []), ...tagsIn(n.body)])];
/** Thẻ và số ghi chú; thẻ lồng (#a/b) tính cả cho thẻ cha #a. */
export function tagCounts(uid: string) {
  const m = new Map<string, number>();
  for (const n of allNotes(uid)) { const seen = new Set<string>(); for (const t0 of tagsOf(n)) { const parts = t0.split("/"); for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join("/")); } for (const x of seen) m.set(x, (m.get(x) ?? 0) + 1); }
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
const KIND_WORD: Record<string, NoteKind[]> = { chat: ["chat", "code"], "doan-chat": ["chat", "code"], code: ["code"], topic: ["topic"], "chu-de": ["topic"], note: ["note"], "ghi-chu": ["note"], daily: ["daily"], "nhat-ky": ["daily"], skill: ["skill"], connector: ["connector"], model: ["model"], hub: ["hub"] };
// Việc dang dở: của nhánh đoạn chat (chưng cất) và các dòng "- [ ]" trong ghi chú người dùng tự viết (nhật ký chỉ chép lại, không tính).
const openTasks = (n: Note) => { const done = new Set((n.props.done ?? []).map(fold)); return [...(n.props.tasks ?? []).filter((x) => !done.has(fold(x))), ...(GENERATED.includes(n.kind) ? [] : [...n.body.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map((m) => m[1]))]; };
/**
 * Tìm như Obsidian: chữ thường (xếp hạng BM25), "cụm từ", -loại trừ, tag:thẻ (gồm thẻ con), loai:chu-de / doan-chat / ghi-chu / nhat-ky,
 * file:tên, task-todo: (ghi chú còn việc chưa xong), [thuộc tính] / [thuộc tính:giá trị] (vd. [model:claude], [importance:5]).
 */
export function queryNotes(uid: string, raw: string, k = 40) {
  let notes = allNotes(uid);
  const terms: string[] = [];
  for (const m of raw.matchAll(/(-?)(\[[^\]]+\]|"[^"]+"|\S+)/g)) {
    const neg = m[1] === "-", tok = m[2], low = fold(tok);
    let f: ((n: Note) => boolean) | null = null;
    if (low.startsWith("tag:")) { const tg = low.slice(4).replace(/^#/, ""); f = (n) => tagsOf(n).some((x) => fold(x) === tg || fold(x).startsWith(`${tg}/`)); }
    else if (low.startsWith("loai:") || low.startsWith("kind:")) { const ks = KIND_WORD[low.split(":")[1]] ?? []; f = (n) => ks.includes(n.kind); }
    else if (low.startsWith("file:") || low.startsWith("ten:")) { const v = low.split(":").slice(1).join(":"); f = (n) => fold(n.title).includes(v); }
    else if (low.startsWith("task-todo:")) { const v = low.slice(10); f = (n) => openTasks(n).some((x) => !v || fold(x).includes(v)); }
    else if (low.startsWith("[") && low.endsWith("]")) {
      const [key, ...rest] = low.slice(1, -1).split(":"), val = rest.join(":").trim();
      f = (n) => { const pv = (n.props as Record<string, unknown>)[key === "model" ? "models" : key]; if (pv === undefined || pv === null) return false; if (!val) return true; const sv = fold(typeof pv === "object" ? JSON.stringify(pv) : String(pv)); return sv.includes(val); };
    } else if (tok.startsWith('"')) { const ph = fold(tok.slice(1, -1)); f = (n) => fold(`${n.title}\n${n.body}`).includes(ph); }
    else if (neg) { f = (n) => fold(`${n.title}\n${n.body}`).includes(low); }
    else terms.push(tok);
    if (f) { const ff = f; notes = notes.filter((n) => (neg ? !ff(n) : ff(n))); }
  }
  const list = terms.length ? rankNotes(notes, terms.join(" "), k, 0.2) : notes.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, k);
  const first = terms[0] ? fold(terms[0]) : "";
  return list.map((n) => ({ note: n, snippet: (n.body.split("\n").find((l) => first && fold(l).includes(first)) ?? n.props.gist ?? n.body.split("\n").find((l) => l.trim()) ?? "").replace(/^[-*#\s]+/, "").slice(0, 200) }));
}
/** Bảng kiểu Bases: đoạn chat, chủ đề, việc còn dang dở trên khắp bộ não. */
export function brainTable(uid: string, view: string) {
  const notes = allNotes(uid), deg = backlinkCounts(uid);
  if (view === "tasks") return notes.flatMap((n) => openTasks(n).map((task) => ({ task, title: n.title, kind: n.kind, date: n.props.date ?? n.createdAt })))
    .concat(notes.flatMap((n) => (n.props.done ?? []).map((task) => ({ task, title: n.title, kind: n.kind, date: n.props.date ?? n.createdAt, done: true } as never)))).sort((a, b) => b.date - a.date);
  if (view === "topics") return notes.filter((n) => n.kind === "topic").map((n) => ({ title: n.title, links: deg.get(fold(n.title)) ?? 0, aliases: n.props.aliases ?? [], updatedAt: n.updatedAt, desc: n.props.desc || n.body.split("\n")[0].slice(0, 160) })).sort((a, b) => b.links - a.links);
  return notes.filter((n) => n.kind === "chat" || n.kind === "code").map((n) => ({ title: n.title, kind: n.kind, date: n.props.date ?? n.createdAt, models: Object.keys(n.props.models ?? {}).map((m) => m.split("/").slice(1).join("/") || m), topics: n.props.topics ?? [], importance: n.props.importance ?? null, turns: n.props.turns ?? 0, tasks: openTasks(n).length, distilled: !!n.props.distilledAt })).sort((a, b) => b.date - a.date);
}
/** Đánh dấu một việc đã xong / chưa xong (ghi chú đoạn chat viết lại ô [x]; ghi chú riêng sửa thẳng dòng "- [ ]"). */
export function setTask(user: UserRow, title: string, task: string, done: boolean) {
  const n = findNote(user.id, title);
  if (!n) throw new Error("Không tìm thấy ghi chú.");
  if (n.kind === "chat" || n.kind === "code") {
    const cur = new Set((n.props.done ?? []).map(fold)), list = (n.props.done ?? []).filter((x) => fold(x) !== fold(task));
    if (done && !cur.has(fold(task))) list.push(task);
    const props = { ...n.props, done: done ? list : list };
    put(user.id, { id: n.id, kind: n.kind, title: n.title, conv: n.conv, body: chatBody(props), props });
  } else if (!GENERATED.includes(n.kind)) {
    const re = new RegExp(`^(\\s*[-*]\\s+)\\[${done ? " " : "x"}\\](\\s+${esc(task)}\\s*)$`, "imu");
    put(user.id, { id: n.id, kind: n.kind, title: n.title, body: n.body.replace(re, `$1[${done ? "x" : " "}]$2`), props: n.props });
  } else throw new Error("Không sửa được việc trong ghi chú này.");
  return brainTable(user.id, "tasks");
}

// ---------------------------------------------------------------- ghi chú hằng ngày
function refreshDaily(uid: string, ms: number) {
  const key = dayKey(ms), title = dailyTitle(ms);
  const chats = allNotes(uid).filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.distilledAt && n.props.date && dayKey(n.props.date) === key);
  if (!chats.length) return;
  const topics = [...new Set(chats.flatMap((n) => n.props.topics ?? []))];
  const tasks = chats.flatMap((n) => openTasks(n).map((x) => `- [ ] ${x} (từ ${L(n.title)})`));
  const cur = getNote(uid, title);
  const d = new Date(ms);
  const body = `Những gì bạn đã cùng Synchro làm ngày ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}. Thuộc ${L(HUB)}.\n\n## Đoạn chat\n${chats.map((n) => `- ${L(n.title)}: ${n.props.gist ?? ""}`).join("\n")}\n${topics.length ? `\n## Chủ đề đã chạm tới\n${topics.map(L).join(" · ")}\n` : ""}${tasks.length ? `\n## Còn dang dở\n${tasks.join("\n")}\n` : ""}${cur?.props.userNote?.trim() ? `\n## Ghi chú của bạn\n${cur.props.userNote.trim()}\n` : ""}`;
  if (!cur || cur.body !== body) put(uid, { id: cur?.id, kind: "daily", title, body, props: { ...(cur?.props ?? {}), day: key, date: ms, tags: ["nhat-ky"], auto: true } });
}

// ---------------------------------------------------------------- nhập thư mục Obsidian (.zip)
/** Nhập ghi chú từ một thư mục Obsidian (hoặc bộ não đã tải về): mỗi tệp .md thành một ghi chú, giữ thẻ, bí danh và [[liên kết]]. */
export async function importVault(user: UserRow, data: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  let created = 0, skipped = 0;
  const files = Object.values(zip.files).filter((f) => !f.dir && /\.md$/i.test(f.name) && !/(^|\/)\./.test(f.name)).slice(0, 2000);
  for (const f of files) {
    const text = (await f.async("string")).replace(/\r\n?/g, "\n");
    const title = cleanName(f.name.split("/").pop()!.replace(/\.md$/i, ""));
    if (!title || SYSTEM_TITLES.has(fold(title)) || /^nhat ky \d{4}-\d{2}-\d{2}$/.test(fold(title))) { skipped++; continue; }
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    const meta = fm?.[1] ?? "", list = (key: string) => {
      const inline = new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, "m").exec(meta)?.[1];
      if (inline !== undefined) return inline.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      const block = new RegExp(`^${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, "m").exec(meta)?.[1];
      if (block) return block.split("\n").map((x) => x.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      const one = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(meta)?.[1];
      return one ? [one.trim().replace(/^["']|["']$/g, "")] : [];
    };
    let body = text.slice(fm ? fm[0].length : 0).replace(new RegExp(`^#\\s+${esc(title)}\\s*\\n+`), "");
    const kindRaw = list("kind")[0] as NoteKind | undefined;
    const kind: NoteKind = kindRaw === "topic" ? "topic" : "note";
    const have = getNote(user.id, title);
    if (have && have.kind !== "note" && have.kind !== "topic") { skipped++; continue; }
    if (have && fold(have.body) === fold(body)) { skipped++; continue; }
    body = body.slice(0, 50_000);
    put(user.id, { id: have?.id, kind: have?.kind ?? kind, title: have?.title ?? title, body, props: { ...(have?.props ?? {}), tags: [...new Set([...(have?.props.tags ?? []), ...list("tags").map((x) => x.replace(/^#/, "").toLowerCase())])], aliases: [...new Set([...(have?.props.aliases ?? []), ...list("aliases")])] } });
    created++;
  }
  refreshHub(user.id);
  return { created, skipped, files: files.length };
}
const SYSTEM_TITLES = new Set([fold(HUB), fold(ABOUT), "claude", "chatgpt", "gemini"]);

// ---------------------------------------------------------------- công cụ cho model (model nào cũng đọc, ghi được bộ não)
export const BRAIN_TOOLS = [
  { name: "brain_search", description: "Tìm trong bộ não chung của Synchro: ghi chú chưng cất từ các đoạn chat cũ, chủ đề, nhật ký hằng ngày, ghi chú riêng của người dùng. Dùng khi người dùng nhắc chuyện đã làm trước đây (\"lần trước\", \"hôm qua\", \"kế hoạch của mình\"), hay khi cần bối cảnh dài hạn của họ. query hỗ trợ tag:thẻ, loai:chu-de|doan-chat|ghi-chu|nhat-ky, task-todo:, [thuộc tính:giá trị], \"cụm từ\", -loại trừ.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "brain_read", description: "Đọc đầy đủ một ghi chú trong bộ não theo tên hoặc bí danh, kèm danh sách ghi chú nó liên kết tới và các ghi chú trỏ về nó; đi theo [[liên kết]] bằng cách đọc tiếp ghi chú khác.", input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "brain_write", description: "Ghi vào bộ não khi người dùng bảo nhớ, lưu hay ghi lại điều gì: tạo hoặc nối thêm vào một ghi chú riêng của họ (Markdown; dùng [[Tên ghi chú]] để nối tới ghi chú khác, #thẻ để gắn thẻ). Không tự ý ghi khi người dùng không yêu cầu.", input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, mode: { type: "string", enum: ["append", "replace"] } }, required: ["title", "content"] } },
];
export const BRAIN_RULES = `<synchro_brain>
Bạn dùng chung bộ não của Synchro với mọi model khác (Claude, ChatGPT, Gemini). Khi người dùng nhắc tới chuyện cũ, kế hoạch, mục tiêu hay điều họ từng nói mà phần đã biết chưa đủ, dùng brain_search rồi brain_read (đi theo [[liên kết]]) để nhớ lại trước khi trả lời. Khi họ bảo ghi nhớ hay lưu lại, dùng brain_write. Nói như người tự nhớ ra, không nhắc tên công cụ.
</synchro_brain>`;
export function runBrainTool(uid: string, name: string, input: Record<string, unknown>): { content: string; is_error: boolean } {
  const user = getUser(uid);
  if (!user) return { content: "Không tìm thấy người dùng.", is_error: true };
  try {
    if (name === "brain_search") {
      const r = queryNotes(uid, String(input.query ?? "").slice(0, 300), 8);
      return { content: r.length ? r.map(({ note: n, snippet }) => `- [[${n.title}]] (${n.kind}${n.props.date ? `, ${day(n.props.date)}` : ""}): ${n.props.gist ?? snippet}`).join("\n") : "Không có ghi chú nào khớp.", is_error: false };
    }
    if (name === "brain_read") {
      const n = findNote(uid, String(input.title ?? ""));
      if (!n) return { content: "Bộ não chưa có ghi chú này.", is_error: true };
      const d = brainNote(user, n.title)!;
      return { content: `# ${n.title}\n(${n.kind}${n.props.aliases?.length ? `; còn gọi là ${n.props.aliases.join(", ")}` : ""})\n\n${n.body.slice(0, 12_000)}\n\nLiên kết đến đây: ${d.backlinks.map((b) => `[[${b.title}]]`).join(", ") || "(không có)"}`, is_error: false };
    }
    if (name === "brain_write") {
      const title = cleanName(String(input.title ?? "")), content = String(input.content ?? "").slice(0, 20_000);
      if (!title || !content.trim()) return { content: "Cần tên ghi chú và nội dung.", is_error: true };
      const n = findNote(uid, title);
      if (n && !["note", "topic"].includes(n.kind)) {
        const r = saveNote(user, n.title, { userNote: `${n.props.userNote ? `${n.props.userNote}\n\n` : ""}${content}` });
        return { content: `Đã thêm vào phần ghi chú của bạn trong [[${r.title}]].`, is_error: false };
      }
      const body = n && input.mode !== "replace" ? `${n.body.trimEnd()}\n\n${content}` : content;
      const r = saveNote(user, n?.title ?? title, { body, newTitle: n ? undefined : title });
      return { content: `Đã lưu vào bộ não: [[${r.title}]].`, is_error: false };
    }
  } catch (e) { return { content: (e as Error).message, is_error: true }; }
  return { content: "Công cụ không tồn tại.", is_error: true };
}
export const brainReady = (uid: string) => learning(uid);

// ---------------------------------------------------------------- xem và sửa (Cài đặt → Bộ não)
export type GraphNode = { id: string; title: string; kind: NoteKind | "ghost"; tags: string[]; created: number; links: number; aliases?: string[]; pinned?: boolean };
export function brainGraph(user: UserRow) {
  ensureBase(user);
  const uid = user.id, notes = allNotes(uid);
  const byK = resolver(notes);
  const links = t().prepare("SELECT src, dkey, dtitle FROM brain_links WHERE user_id = ?").all(uid) as { src: string; dkey: string; dtitle: string }[];
  const ghosts = new Map<string, GraphNode>();
  const edges: { s: string; t: string }[] = [];
  const deg = new Map<string, number>();
  for (const l of links) {
    const dst = byK.get(l.dkey);
    let to = dst?.id;
    if (!to) { to = `ghost:${l.dkey}`; if (!ghosts.has(to)) ghosts.set(to, { id: to, title: l.dtitle, kind: "ghost", tags: [], created: Date.now(), links: 0 }); }
    if (to === l.src || edges.some((e) => e.s === l.src && e.t === to)) continue;
    edges.push({ s: l.src, t: to });
    deg.set(to, (deg.get(to) ?? 0) + 1); deg.set(l.src, (deg.get(l.src) ?? 0) + 1);
  }
  const nodes: GraphNode[] = [...notes.map((n) => ({ id: n.id, title: n.title, kind: n.kind, tags: tagsOf(n), created: n.createdAt, links: deg.get(n.id) ?? 0, aliases: n.props.aliases ?? [], pinned: !!n.props.pinned })), ...[...ghosts.values()].map((x) => ({ ...x, links: deg.get(x.id) ?? 0 }))];
  return { nodes, edges, stats: { notes: notes.length, links: edges.length, chats: notes.filter((n) => (n.kind === "chat" || n.kind === "code") && n.props.distilledAt).length, topics: notes.filter((n) => n.kind === "topic").length, pending: pendingCount(uid), memories: listMemory(uid).length } };
}
/** Một ghi chú kèm liên kết đi (có / chưa có ghi chú), liên kết đến đây và chỗ nhắc tên mà chưa nối (như Obsidian). */
export function brainNote(user: UserRow, title: string) {
  ensureBase(user);
  const uid = user.id, n = findNote(uid, title);
  if (!n) return null;
  const notes = allNotes(uid), byK = resolver(notes);
  const out = linksIn(n.body).map((l) => ({ title: byK.get(fold(l))?.title ?? l, exists: byK.has(fold(l)) }));
  const keys = namesOf(n).map(fold);
  const srcs = t().prepare(`SELECT DISTINCT src FROM brain_links WHERE user_id = ? AND dkey IN (${keys.map(() => "?").join(",")})`).all(uid, ...keys) as { src: string }[];
  const around = (body: string, needle: string) => {
    const line = body.split("\n").find((l) => fold(l).includes(fold(needle))) ?? "";
    return line.replace(/^[-*#\s]+/, "").slice(0, 220);
  };
  const back = srcs.map((s) => notes.find((x) => x.id === s.src)).filter((x): x is Note => !!x && x.id !== n.id).map((x) => ({ title: x.title, kind: x.kind, context: namesOf(n).map((nm) => around(x.body, `[[${nm}`)).find(Boolean) || around(x.body, n.title) }));
  const linked = new Set(back.map((b) => b.title));
  // Nhắc tên mà chưa nối (gồm cả bí danh), trong chữ thường của ghi chú khác.
  const mention = (body: string, names: string[]) => { const b = fold(body.replace(LINK, " ")); return names.find((nm) => nm.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(fold(nm))}($|[^\\p{L}\\p{N}])`, "u").test(b)); };
  const unlinked = notes.filter((x) => x.id !== n.id && !linked.has(x.title) && mention(x.body, namesOf(n)))
    .slice(0, 20).map((x) => ({ title: x.title, kind: x.kind, context: around(x.body.replace(LINK, (_m, a, b) => b || a), mention(x.body, namesOf(n))!), canLink: !GENERATED.includes(x.kind) || x.kind === "chat" || x.kind === "code" }));
  // Liên kết đi chưa nối: tên ghi chú khác xuất hiện trong ghi chú này mà chưa thành liên kết (Outgoing links của Obsidian).
  const outKeys = new Set(out.map((o) => fold(o.title)));
  const outUnlinked = n.kind === "hub" || n.kind === "daily" ? [] : notes.filter((x) => x.id !== n.id && !outKeys.has(fold(x.title)) && x.kind !== "hub" && mention(n.body, namesOf(x)))
    .slice(0, 15).map((x) => ({ title: x.title, kind: x.kind, matched: mention(n.body, namesOf(x))! }));
  return { note: { ...n, editable: !SYSTEM_NOTES.includes(n.kind), generated: GENERATED.includes(n.kind), tags: tagsOf(n), canLink: !GENERATED.includes(n.kind) || n.kind === "chat" || n.kind === "code" }, outgoing: out, outUnlinked, backlinks: back, unlinked };
}
/** Sửa ghi chú: ghi chú Synchro tự viết thì chỉ sửa phần "Ghi chú của bạn"; ghi chú chủ đề / ghi chú riêng thì sửa cả nội dung. */
export function saveNote(user: UserRow, title: string, patch: { body?: string; userNote?: string; newTitle?: string; aliases?: string[]; tags?: string[]; pinned?: boolean }) {
  const n0 = findNote(user.id, title);
  // Thuộc tính (bí danh, thẻ, ghim) sửa được ở mọi ghi chú.
  if (n0 && (patch.aliases || patch.tags || patch.pinned !== undefined)) {
    const props = { ...n0.props, ...(patch.aliases ? { aliases: [...new Set(patch.aliases.map(cleanName).filter((a) => a && fold(a) !== fold(n0.title)))].slice(0, 20) } : {}), ...(patch.tags ? { tags: [...new Set(patch.tags.map((x) => x.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 30) } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}) };
    put(user.id, { id: n0.id, kind: n0.kind, title: n0.title, conv: n0.conv, body: n0.body, props });
    if (patch.body === undefined && patch.userNote === undefined && !patch.newTitle) return getNote(user.id, n0.title)!;
  }
  const n = n0 ? getNote(user.id, n0.title) : null;
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
  const saved = put(user.id, { id: n.id, kind: n.kind, title: newTitle, body: (patch.body ?? n.body).slice(0, 50_000), props: n.props });
  if (newTitle !== n.title) relink(user, n.title, newTitle);
  return saved;
}
export function deleteNote(user: UserRow, title: string) {
  const n = findNote(user.id, title);
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
const FOLDER: Record<NoteKind, string> = { hub: "", about: "", model: "Bán cầu", chat: "Đoạn chat", code: "Synchro Code", topic: "Chủ đề", skill: "Skill", connector: "Connector", note: "Ghi chú", daily: "Nhật ký" };
export async function exportVault(user: UserRow): Promise<ArrayBuffer> {
  ensureBase(user);
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip(), root = zip.folder("Bộ não Synchro")!;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
  for (const n of allNotes(user.id)) {
    const fm = [`kind: ${n.kind}`, `created: ${new Date(n.createdAt).toISOString()}`, `updated: ${new Date(n.updatedAt).toISOString()}`,
      n.props.tags?.length ? `tags: [${n.props.tags.join(", ")}]` : "", n.props.importance ? `importance: ${n.props.importance}` : "",
      n.props.models ? `models: [${Object.keys(n.props.models).join(", ")}]` : "", n.props.aliases?.length ? `aliases: [${n.props.aliases.map((a) => JSON.stringify(a)).join(", ")}]` : "",
      n.props.date ? `date: ${dayKey(n.props.date)}` : ""].filter(Boolean).join("\n");
    const dir = FOLDER[n.kind];
    root.file(`${dir ? `${dir}/` : ""}${safe(n.title)}.md`, `---\n${fm}\n---\n# ${n.title}\n\n${n.body}`);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}
