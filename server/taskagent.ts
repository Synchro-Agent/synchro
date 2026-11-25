// Việc tự động chạy bằng Synchro Code (tasks.ts, engine "code"): một lượt agent trong workspace riêng của việc (repo, tệp giữ lại giữa các lần chạy),
// đủ công cụ của Synchro Code (sửa tệp, chạy lệnh, git, GitHub, trình duyệt, skill) cộng autopilot_propose. Không ai ngồi duyệt giữa chừng nên câu hỏi
// duyệt (lệnh ở chế độ hỏi trước, trang web chưa được phép) thành đề xuất trong mục Cần duyệt của Autopilot và lượt chạy làm tiếp phần còn lại.
import "server-only";
import { answer } from "./approvals";
import { usableModels } from "./ai/anymodel";
import { QUEUED } from "./agentgate";
import { pickAgentModel, runAgentTurn } from "./agentturn";
import { ModelError } from "./agentcore";
import { can } from "./authstore";
import { getPrefs, type PermMode } from "./codestore";
import { progress, registerExec, runSignal, takeInbox } from "./runs";
import { queueAsk, runPropose, TASK_TOOL, taskOf } from "./tasktools";

// Bước đang làm, hiện ở Autopilot khi việc đang chạy và trong nhật ký.
const describe = (name: string, a: Record<string, unknown>) => {
  const s = (k: string) => String(a[k] ?? "").split("\n")[0].slice(0, 160);
  return name === "bash" ? `Chạy lệnh: ${s("description") || s("command")}` : name === "write_file" ? `Ghi tệp ${s("path")}` : name === "edit_file" ? `Sửa tệp ${s("path")}`
    : name === "read_file" ? `Đọc tệp ${s("path")}` : name === "list_files" ? `Xem thư mục ${s("path") || "."}` : name === "grep" ? `Tìm "${s("pattern")}"`
    : name === TASK_TOOL.name ? `Gửi đề xuất vào mục Cần duyệt của Autopilot: ${s("title")}` : name.startsWith("browser_") ? `Trình duyệt: ${s("url") || name.slice(8)}` : name;
};

registerExec("agent", async (body, user) => {
  const task = taskOf(body);
  if (!task || typeof body.sid !== "string") return { http: 400, json: { error: "Thiếu thông tin việc tự động." } };
  if (!can(user, "code")) return { http: 403, json: { error: "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code." } };
  const messages = (Array.isArray(body.messages) ? body.messages : []) as { role: string; content: unknown }[];
  const pick = await pickAgentModel(user, body.model ?? "auto", messages, "auto");
  if ("error" in pick) return { http: pick.status, json: { error: pick.error, ...(pick.usageLimit ? { usageLimit: true } : {}) } };
  // Chế độ quyền: Tự động khi người dùng cho phép (Cài đặt → Synchro Code); không thì tự sửa tệp, lệnh cần duyệt thành đề xuất.
  const prefs = getPrefs(user.id);
  const perm = { mode: (prefs.allowBypass ? "auto" : "edits") as PermMode, allow: Array.isArray(body.allow) ? (body.allow as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : [] };
  // Tên model như ở bộ chọn model, không phải mã thô.
  const shown = (await usableModels(user).catch(() => null))?.groups.flatMap((g) => g.models).find((m) => m.key === pick.model)?.name ?? pick.model.split("/").pop();
  progress("note", `Synchro Code · ${shown} · ${perm.mode === "auto" ? "chế độ Tự động" : "tự sửa tệp, lệnh cần duyệt"}`);
  let said = "";
  try {
    const r = await runAgentTurn({
      user, sid: body.sid, pick, system: String(body.system ?? ""), messages, skills: true, signal: runSignal() ?? new AbortController().signal, inbox: takeInbox, perm,
      quiet: true, maxSteps: 120,
      extra: [{ def: TASK_TOOL, run: (input) => runPropose(user.id, task, input) }],
      onAsk: (a) => { queueAsk(user.id, task, a); answer(user.id, a.id, { ok: false, note: QUEUED }); },
      emit: (e) => {
        if (e.t === "text") said = e.text;
        else if (e.t === "tool") { if (said.trim()) progress("say", said.trim()); said = ""; progress("tool", describe(e.name, e.input)); }
        else if (e.t === "plan") progress("plan", JSON.stringify(e.items));
        else if (e.t === "result" && !e.ok) progress("note", `Không được: ${e.summary}`);
      },
    });
    return { http: 200, json: { text: r.text, model: pick.model, skills: r.skills } };
  } catch (e) {
    return { http: e instanceof ModelError ? (e.status >= 500 ? 502 : e.status) : 502, json: { error: String((e as Error).message ?? e) } };
  }
});
