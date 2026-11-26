// Autopilot: (1) lời giao việc bằng câu thường → kế hoạch việc tự động (tên, lịch, trình duyệt, hướng dẫn chi tiết cho
// model chạy nền), người dùng xem / sửa rồi tạo; (2) người dùng duyệt đề xuất của việc tự động → Synchro làm: tạo
// skill, làm hành động đã duyệt (lượt chạy riêng, kết quả vào Autopilot), cho phép trang web, gọi công cụ connector để
// "hỏi trước" với đúng tham số đã đề xuất.
import "server-only";
import JSZip from "jszip";
import { isAdmin, permsOf, type UserRow } from "./authstore";
import { quickCall } from "./ai/anymodel";
import { connPolicy } from "../shared/catalog";
import { allowSite } from "./codestore";
import { ConnectorSession } from "./connectors";
import { removeSkill, saveSkill } from "./skillstore";
import { publishSkill } from "./plugins";
import { can } from "./authstore";
import { claimProposal, cleanBrowser, cleanEngine, cleanSchedule, getProposal, localTime, runApproved, settleProposal, TaskError, type BrowserPref, type Engine, type Proposal, type Schedule } from "./tasks";

// ---------------------------------------------------------------- lời giao việc → kế hoạch
export type Plan = { title: string; prompt: string; schedule: Schedule; browser: BrowserPref; engine: Engine; approvals: string[]; needs: string[] };
const PLAN = `<automation_plan>
Người dùng giao một việc cho Autopilot để Synchro tự làm ở nền theo lịch (máy chủ của Synchro chạy, người dùng không \
ngồi xem, máy họ có thể đang tắt; kết quả thành một đoạn chat để họ hỏi tiếp). Chuyển lời giao việc thành kế hoạch.
Trả về đúng một JSON, không gì khác:
{"title":"…","schedule":{"kind":"once|hourly|daily|weekdays|weekly|cron","time":"HH:MM","weekday":1,"every":1,\
"at":"YYYY-MM-DDTHH:MM","cron":"phút giờ ngày tháng thứ"},"engine":"chat|code","browser":"auto|synchro|user",\
"prompt":"…","approvals":["…"],"needs":["…"]}
- title: tên ngắn (tối đa 8 từ), cùng ngôn ngữ người dùng.
- schedule: theo lời người dùng. "Mỗi ngày" không nói giờ thì 08:00. Giá cổ phiếu, chứng khoán, tỷ giá: weekdays (thứ \
Hai–thứ Sáu) trừ khi người dùng nói khác. weekly: weekday 0 = Chủ nhật … 6 = Thứ Bảy. hourly: every = số giờ giữa hai \
lần (1–12). "Một lần", "ngay bây giờ": once không có at. Một lần vào một lúc cụ thể ("9h sáng mai", "20:00 ngày \
30/11"): once kèm at là giờ địa phương YYYY-MM-DDTHH:MM, tính từ "Bây giờ" bên dưới. Lịch không có trong các loại trên \
(hằng tháng, vài ngày cố định trong tuần, nhiều giờ trong ngày): cron 5 trường theo giờ địa phương, trường phút là một \
số (ví dụ "0 9 1 * *" là 9:00 ngày 1 hằng tháng, "30 8,17 * * 1-5" là 8:30 và 17:30 từ thứ Hai tới thứ Sáu).
- engine: "code" khi việc phải làm trên mã nguồn / repo (sửa code, chạy lệnh, cập nhật thư viện, chạy kiểm thử, commit, mở pull request, sửa lỗi CI…): chạy bằng Synchro Code trong workspace riêng; còn lại "chat" (tra cứu, tổng hợp, phân tích, trình duyệt, connector, skill, chạy code ngắn).
- browser: "user" chỉ khi việc cần tài khoản người dùng đã đăng nhập (email, mạng xã hội, tài khoản chứng khoán, trang nội bộ…); còn lại "auto".
- prompt: hướng dẫn chi tiết, đủ để một trợ lý khác tự làm mà không cần hỏi lại, viết bằng ngôn ngữ người dùng: mục \
tiêu; nguồn nên tra (trang cụ thể nếu biết); các bước; tiêu chí chọn lọc / đánh giá; định dạng kết quả (tóm tắt trước, \
bảng nếu hợp, nguồn ở cuối); so sánh với lần chạy trước; những việc phải gửi đề xuất chờ người dùng duyệt bằng \
autopilot_propose thay vì tự làm (ví dụ tạo skill, gửi tin, giao dịch).
- approvals: các việc sẽ gửi đề xuất chờ người dùng duyệt (ví dụ "Tạo skill từ repo được chọn"); [] nếu không có.
- needs: điều kiện cần có để chạy tốt (ví dụ "Bật Điều khiển trình duyệt", "Kết nối Gmail"); [] nếu không có.
</automation_plan>`;
const strs = (x: unknown, n: number) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim().slice(0, 160)).slice(0, n) : []);
/** Lời giao việc → kế hoạch. Model không trả lời được thì dựng kế hoạch tối thiểu từ chính lời giao việc (mỗi ngày 08:00). */
export async function planAutomation(user: UserRow, text: string, tz: string): Promise<{ plan: Plan; model: string | null }> {
  const t = text.trim().slice(0, 4000);
  if (!t) throw new TaskError("Hãy viết việc bạn muốn Synchro tự làm.");
  const base: Plan = { title: t.replace(/\s+/g, " ").split(" ").slice(0, 8).join(" ").slice(0, 120), prompt: t, schedule: cleanSchedule({ kind: "daily", time: "08:00", tz }), browser: "auto", engine: "chat", approvals: [], needs: [] };
  // Tài khoản chưa được dùng Synchro Code thì việc về mã nguồn vẫn chạy bằng chat (chạy code, connector GitHub nếu có).
  const codeOk = can(user, "code");
  try {
    const { text: out, model } = await quickCall(user, PLAN, `Việc cần tự động hóa:\n${t}\n\nBây giờ: ${localTime(cleanSchedule({ tz }).tz, Date.now())} (${tz})`, { maxTokens: 2000, job: "automate" });
    const j = JSON.parse(/\{[\s\S]*\}/.exec(out)?.[0] ?? "{}") as Record<string, unknown>;
    const prompt = typeof j.prompt === "string" && j.prompt.trim() ? j.prompt.trim().slice(0, 8000) : base.prompt;
    return {
      model,
      plan: {
        title: typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, 120) : base.title, prompt,
        schedule: cleanSchedule({ ...(j.schedule && typeof j.schedule === "object" ? j.schedule : {}), tz }), browser: cleanBrowser(j.browser), engine: codeOk ? cleanEngine(j.engine) : "chat",
        approvals: strs(j.approvals, 6), needs: strs(j.needs, 6),
      },
    };
  } catch (e) {
    if (e instanceof TaskError) throw e;
    return { plan: base, model: null };
  }
}

// ---------------------------------------------------------------- duyệt đề xuất
/** scope "org" (quản trị viên): skill đã duyệt vào "Thư viện cho mọi người" thay vì Skill của bạn. */
type Edits = { skill_md?: unknown; instructions?: unknown; scope?: unknown };
/** Người dùng duyệt / bỏ qua một đề xuất. Duyệt thì làm ngay; lỗi (vd. SKILL.md đã sửa sai) thì đề xuất trở lại "chờ duyệt" để sửa và thử lại. */
export async function decideProposal(user: UserRow, id: string, decision: "approve" | "reject", edits: Edits = {}): Promise<{ proposal: Proposal; run?: string }> {
  const p = getProposal(user.id, id);
  if (!p) throw new TaskError("Không tìm thấy đề xuất.", 404);
  if (p.status !== "pending") throw new TaskError(p.status === "running" ? "Đề xuất này đang được thực hiện." : "Đề xuất này đã được xử lý.", 409);
  if (decision === "reject") {
    if (!claimProposal(user.id, id, "rejected")) throw new TaskError("Đề xuất này đã được xử lý.", 409);
    return { proposal: getProposal(user.id, id)! };
  }
  if (!claimProposal(user.id, id, "running")) throw new TaskError("Đề xuất này đã được xử lý.", 409);
  const pl = p.payload;
  try {
    if (p.kind === "skill") {
      const md = typeof edits.skill_md === "string" && edits.skill_md.trim() ? edits.skill_md : String(pl.skill_md ?? "");
      const files = (Array.isArray(pl.files) ? pl.files : []) as { path: string; content: string }[];
      let name = "SKILL.md", buf: Buffer = Buffer.from(md);
      if (files.length) {
        const z = new JSZip();
        z.file("skill/SKILL.md", md);
        for (const f of files) z.file(`skill/${f.path}`, f.content);
        name = "skill.zip"; buf = await z.generateAsync({ type: "nodebuffer" });
      }
      const r = await saveSkill(user.id, name, buf, { enabled: true });
      if (edits.scope === "org") {
        if (!isAdmin(user)) throw new TaskError("Chỉ quản trị viên thêm được skill vào thư viện cho mọi người.", 403);
        await publishSkill(r.skill, { name: user.full_name || user.name || user.email });
        await removeSkill(user.id, r.skill.name);
      }
      settleProposal(user.id, id, "done", edits.scope === "org" ? `Đã tạo skill ${r.skill.name} và thêm vào thư viện cho mọi người.` : `${r.created ? "Đã tạo skill" : "Đã cập nhật skill"} ${r.skill.name} và bật để dùng.`, md !== pl.skill_md ? { ...pl, skill_md: md, name: r.skill.name } : undefined);
      return { proposal: getProposal(user.id, id)! };
    }
    if (p.kind === "action") {
      const instructions = typeof edits.instructions === "string" && edits.instructions.trim() ? edits.instructions.trim().slice(0, 8000) : String(pl.instructions ?? "");
      const run = await runApproved(user.id, p.task, p.title, instructions, Array.isArray(pl.allow) ? (pl.allow as unknown[]).filter((x): x is string => typeof x === "string") : []);
      settleProposal(user.id, id, "done", "Synchro đang làm việc đã duyệt, kết quả vào Autopilot.", { ...pl,
        instructions, run });
      return { proposal: getProposal(user.id, id)!, run };
    }
    if (p.kind === "site") {
      allowSite(user.id, String(pl.host ?? ""));
      settleProposal(user.id, id, "done", `Đã cho phép ${pl.host}. Các lần chạy sau dùng được trang này.`);
      return { proposal: getProposal(user.id, id)! };
    }
    // kind "tool": gọi đúng công cụ connector đã đề xuất với đúng tham số đó (người dùng vừa duyệt lần này).
    const sess = new ConnectorSession(user.id, { pol: connPolicy(permsOf(user)) });
    try {
      if (!sess.get(String(pl.tool ?? ""))) throw new TaskError("Công cụ này không còn (connector đã gỡ hoặc tắt).", 410);
      const r = await sess.call(String(pl.tool), (pl.input ?? {}) as Record<string, unknown>);
      settleProposal(user.id, id, r.is_error ? "failed" : "done", r.content.slice(0, 8000));
    } finally { sess.close(); }
    return { proposal: getProposal(user.id, id)! };
  } catch (e) {
    // Làm không được: trả đề xuất về "chờ duyệt" kèm lỗi để người dùng sửa (vd. SKILL.md) và duyệt lại.
    settleProposal(user.id, id, "pending", `Lỗi: ${(e as Error).message}`);
    if (e instanceof TaskError) throw e;
    throw new TaskError((e as Error).message, 422);
  }
}
