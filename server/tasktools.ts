// Công cụ và hướng dẫn riêng cho lượt chạy của việc tự động (tasks.ts): lượt chạy nền không có người xem nên việc cần người dùng đồng ý
// (tạo skill, hành động có tác động, trang web mới, công cụ để "hỏi trước") không chờ hỏi mà thành đề xuất trong mục Cần duyệt của Autopilot.
// Model gọi autopilot_propose; Synchro tự gửi đề xuất trang web / công cụ khi chốt chặn cần hỏi. Người dùng duyệt thì automate.ts làm.
import "server-only";
import path from "node:path";
import { currentRun } from "./runs";
import { getSkill, isAllowed, parseSkillMd } from "./skillstore";
import { propose, TaskError, type BrowserPref, type TaskCtx } from "./tasks";
import type { Ask } from "./approvals";

/** Thông tin việc tự động trong nội dung gửi bộ chạy chat (chỉ tasks.ts đặt; /api/llm bỏ trường này khỏi yêu cầu của trình duyệt). */
export function taskOf(body: Record<string, unknown>): TaskCtx | null {
  const t = body.task as Partial<TaskCtx> | undefined;
  if (!t || typeof t !== "object" || typeof t.id !== "string" || t.id.length > 64) return null;
  const browser: BrowserPref = t.browser === "synchro" || t.browser === "user" ? t.browser : "auto";
  return { id: t.id, browser, chrome: t.chrome === true };
}
/** Trình duyệt mặc định của lượt: Chrome của người dùng chỉ khi việc đặt dùng Chrome và Chrome đang kết nối. */
export const taskBrowser = (t: TaskCtx): "synchro" | "user" => (t.browser === "user" && t.chrome ? "user" : "synchro");

export const TASK_TOOL = {
  name: "autopilot_propose",
  description: "Gửi một đề xuất vào mục Cần duyệt của Autopilot để người dùng duyệt (việc tự động chạy nền không hỏi người dùng giữa chừng được). Dùng cho việc cần người dùng đồng ý trước: kind=\"skill\" tạo skill mới cho người dùng (kèm skill_md hoàn chỉnh và source); kind=\"action\" một hành động có tác động ra bên ngoài hoặc khó hoàn tác (gửi tin / email, đăng bài, mua bán, đặt lệnh, xóa / sửa dữ liệu của người dùng…) kèm instructions để Synchro làm sau khi được duyệt. Không tự làm những việc đó trong lượt này. Mỗi lần gọi là một đề xuất.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["skill", "action"] },
      title: { type: "string", description: "Tên ngắn của đề xuất (ví dụ tên skill, hay \"Gửi email báo giá cho anh Minh\")" },
      summary: { type: "string", description: "Vì sao đề xuất, điểm nổi bật, rủi ro nếu có — người dùng đọc để quyết định (Markdown ngắn)" },
      source: { type: "string", description: "Liên kết nguồn (repo GitHub, bài viết…) nếu có" },
      skill_md: { type: "string", description: "kind=skill: toàn bộ SKILL.md — frontmatter YAML (name: chữ thường, số, gạch ngang; description: làm gì và khi nào dùng) rồi phần hướng dẫn cụ thể, dùng được ngay" },
      files: { type: "array", description: "kind=skill: tệp kèm theo (scripts/…, references/…, assets/…), tối đa 20 tệp chữ", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      instructions: { type: "string", description: "kind=action: hướng dẫn đầy đủ để Synchro tự làm việc này sau khi người dùng duyệt (làm gì, ở đâu, nội dung chính xác)" },
    },
    required: ["kind", "title", "summary"],
  },
};

export function taskRules(t: TaskCtx, browse: boolean) {
  const chrome = t.chrome ? "đang kết nối" : "không kết nối (máy người dùng tắt hoặc Chrome đang đóng)";
  const b = !browse ? "" : t.browser === "synchro"
    ? "- Trình duyệt: chỉ dùng trình duyệt của Synchro (browser=\"synchro\", chạy trên máy chủ). Việc này không dùng Chrome của người dùng."
    : t.browser === "user" && t.chrome
      ? "- Trình duyệt: mặc định dùng Chrome của người dùng (browser=\"user\", đang kết nối, có sẵn tài khoản họ đã đăng nhập). Synchro làm ở tab riêng, không đụng tab họ đang mở. Trang không cần đăng nhập thì có thể dùng trình duyệt của Synchro (browser=\"synchro\")."
      : t.browser === "user"
        ? "- Trình duyệt: việc này đặt dùng Chrome của người dùng nhưng Chrome không kết nối. Dùng trình duyệt của Synchro (browser=\"synchro\"); phần cần tài khoản của người dùng thì ghi rõ chưa làm được và vì sao."
        : `- Trình duyệt: mặc định dùng trình duyệt của Synchro (browser="synchro", chạy trên máy chủ, luôn dùng được). Chrome của người dùng (browser="user") ${chrome}; chỉ dùng khi việc cần tài khoản họ đã đăng nhập, hoặc trang chặn trình duyệt của máy chủ (captcha, chặn truy cập tự động)${t.chrome ? "" : " — lúc này không dùng được, hãy tìm nguồn khác và ghi rõ"}.`;
  return `<automation_tools>
Đây là lượt chạy nền của việc tự động: không có người dùng để hỏi.
- autopilot_propose: gửi đề xuất chờ người dùng duyệt (xem mô tả công cụ). Skill: SKILL.md hoàn chỉnh dùng được ngay (name chữ thường-gạch-ngang, description nói rõ làm gì và khi nào dùng, phần thân là hướng dẫn cụ thể kèm ví dụ), source là liên kết nguồn. Đề xuất đã có (đang chờ hay đã duyệt) thì không gửi lại.
- Trang web chưa được phép hay công cụ để "hỏi trước": Synchro tự gửi yêu cầu duyệt vào mục Cần duyệt của Autopilot và báo lại cho bạn; dùng nguồn khác và ghi rõ trong kết quả.
- Tìm trên web hay API đủ dữ liệu thì không cần mở trình duyệt (nhanh hơn).
${b}
</automation_tools>`.replace(/\n\n<\/automation_tools>/, "\n</automation_tools>");
}

type R = Record<string, unknown>;
const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
/** Công cụ autopilot_propose: kiểm tra đề xuất (skill phải đúng định dạng) rồi ghi vào Autopilot. */
export async function runPropose(uid: string, t: TaskCtx, input: R): Promise<{ content: string; is_error: boolean }> {
  const kind = input.kind === "skill" || input.kind === "action" ? input.kind : null;
  const title = str(input.title, 200), summary = str(input.summary, 4000), source = str(input.source, 500);
  if (!kind || !title || !summary) return { content: "Thiếu kind (skill | action), title hoặc summary.", is_error: true };
  let payload: R, key: string, name = title, doneGone = false;
  if (kind === "skill") {
    const md = typeof input.skill_md === "string" ? input.skill_md : "";
    if (!md.trim() || md.length > 200_000) return { content: "kind=skill cần skill_md (toàn bộ SKILL.md, tối đa 200.000 ký tự).", is_error: true };
    let p: { name: string; description: string };
    try { p = parseSkillMd(md); } catch (e) { return { content: `SKILL.md chưa đúng: ${(e as Error).message}. Sửa rồi gọi lại.`, is_error: true }; }
    const files: { path: string; content: string }[] = [];
    let size = md.length;
    for (const f of Array.isArray(input.files) ? (input.files as R[]).slice(0, 20) : []) {
      const fp = path.posix.normalize(String(f?.path ?? "").replace(/\\/g, "/")).replace(/^\/+/, "");
      if (!fp || fp.startsWith("..") || fp === "SKILL.md" || fp.split("/").some((s) => s.startsWith(".")) || !isAllowed(fp)) return { content: `Tệp "${f?.path}" không hợp lệ (đường dẫn tương đối như scripts/run.py, references/notes.md).`, is_error: true };
      const content = typeof f.content === "string" ? f.content : "";
      size += content.length;
      files.push({ path: fp, content });
    }
    if (size > 500_000) return { content: "Skill quá lớn (tối đa 500.000 ký tự cả tệp kèm theo).", is_error: true };
    name = p.name;
    key = `skill:${p.name}`;
    doneGone = !(await getSkill(uid, p.name));
    payload = { name: p.name, description: p.description, skill_md: md, files, ...(source ? { source } : {}) };
  } else {
    const instructions = str(input.instructions, 8000);
    if (!instructions) return { content: "kind=action cần instructions (Synchro sẽ làm gì sau khi được duyệt).", is_error: true };
    key = `action:${title.toLowerCase()}`;
    payload = { instructions, ...(source ? { source } : {}) };
  }
  try {
    const r = propose(uid, { task: t.id, run: currentRun(), kind, key, title: name, summary, payload, doneGone });
    if (r.dup) return { content: `Đề xuất "${name}" đã có trong mục Cần duyệt của Autopilot (${r.dup.status === "rejected" ? "người dùng đã bỏ qua trước đây" : r.dup.status === "pending" ? "đang chờ người dùng duyệt" : "người dùng đã duyệt trước đây"}), không gửi lại.`, is_error: false };
    return { content: `Đã gửi đề xuất "${name}" vào Autopilot, chờ người dùng duyệt. Không tự làm việc này; trong kết quả cuối, nhắc người dùng xem mục Cần duyệt của Autopilot.`, is_error: false };
  } catch (e) {
    if (e instanceof TaskError) return { content: e.message, is_error: true };
    throw e;
  }
}
/** Chốt chặn cần hỏi người dùng (trang web chưa được phép) trong lượt chạy nền: ghi đề xuất "site" thay vì chờ. */
export function queueSite(uid: string, t: TaskCtx, host: string, url: string) {
  try { propose(uid, { task: t.id, run: currentRun(), kind: "site", key: `site:${host}`, title: host, summary: url ? `Mở ${url}` : `Dùng trình duyệt trên ${host}`, payload: { host, url } }); } catch {}
}
/** Câu hỏi duyệt của Synchro Code chạy nền (lệnh, sửa tệp ở chế độ hỏi trước, trang web chưa được phép): ghi đề xuất thay vì chờ.
 *  Duyệt lệnh / sửa tệp thì Synchro chạy lại đúng việc đó trong workspace của việc tự động, cho phép đúng khóa đó (allow). */
export function queueAsk(uid: string, t: TaskCtx, a: Ask) {
  if (a.kind === "site") return queueSite(uid, t, a.host ?? "", a.detail ?? "");
  const what = a.kind === "bash" ? `Chạy lệnh trong workspace của việc tự động:\n\n\`\`\`\n${a.detail}\n\`\`\`` : `${a.title} trong workspace của việc tự động. Nội dung:\n\n${a.detail}`;
  try {
    propose(uid, { task: t.id, run: currentRun(), kind: "action", key: `ask:${a.key}:${a.detail.slice(0, 200)}`, title: a.title, summary: a.kind === "bash" ? `\`${a.detail.split("\n")[0].slice(0, 300)}\`` : a.title,
      payload: { instructions: `${what}\n\nLàm đúng việc trên rồi báo kết quả.`, allow: [a.key] } });
  } catch {}
}
/** Công cụ connector để "hỏi trước mỗi lần" trong lượt chạy nền: ghi đề xuất "tool" (người dùng duyệt thì Synchro gọi đúng công cụ đó với đúng tham số). */
export function queueTool(uid: string, t: TaskCtx, c: { name: string; input: R }, meta: { connector: string; title: string }) {
  const input = JSON.stringify(c.input ?? {});
  try {
    const r = propose(uid, { task: t.id, run: currentRun(), kind: "tool", key: `tool:${c.name}:${input.slice(0, 200)}`, title: `${meta.connector}: ${meta.title}`, summary: input.length > 1500 ? input.slice(0, 1500) + "…" : input, payload: { tool: c.name, input: c.input ?? {}, connector: meta.connector } });
    return r.dup ? "Đề xuất dùng công cụ này với đúng tham số đó đã có trong mục Cần duyệt của Autopilot." : "Công cụ này để chế độ hỏi trước mỗi lần dùng. Synchro đã gửi yêu cầu duyệt vào mục Cần duyệt của Autopilot (người dùng duyệt thì Synchro gọi công cụ với đúng tham số này). Không thử lại; làm tiếp phần còn lại và ghi rõ trong kết quả.";
  } catch (e) { return e instanceof TaskError ? e.message : "Không gửi được yêu cầu duyệt."; }
}
