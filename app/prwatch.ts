// Theo dõi pull request Synchro Code đã mở (Cài đặt → Synchro Code → Pull request):
// - Tự sửa: CI lỗi hay có góp ý review mới thì Synchro chạy agent ngay trong phiên đã tạo PR (workspace, lịch sử đoạn chat của phiên đó),
//   sửa, chạy lại kiểm thử, commit, push lên đúng nhánh, rồi trả lời trên PR. Lượt chạy nền hiện trong phiên như một lượt bình thường.
// - Tự lưu trữ: PR được gộp hay đóng thì lưu trữ phiên; PR đã gộp thì xóa nhánh trên GitHub và dọn thư mục phiên nếu không còn gì chưa đẩy.
import { getUser, type UserRow } from "./authstore";
import { getLink, gh, gitAuth } from "./github";
import { appendNode, getPrefs, getSession, openPrs, patchPr, patchSession, updateNode, type PrRow } from "./codestore";
import { pickAgentModel, runAgentTurn, sessionMeta } from "./agentturn";
import { AUTO } from "./router";
import { turnsTotal } from "./runs";
import { MAX_LIVE_RUNS } from "./agentruns";
import { isDraining } from "./drain";
import { acquire, withSlot } from "./turngate";
import { exec, sdir, wsAllowed } from "./workspace";
import { withUsage } from "./usage";
import { STYLE_SYS, isStyle } from "./codestyle";
import type { AgentEvent } from "./agentcore";

// Lời trả lời của Synchro trên PR mang dấu này để lần sau không coi là góp ý mới.
export const MARK = "<!-- synchro-code -->";
const MAX_CI_FIXES = 4, MAX_RUNS = 12;
const busy = new Set<string>();
const hhmm = () => new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

type Pull = { state: string; merged: boolean; html_url: string; head: { sha: string; ref: string }; base: { ref: string } };
type CheckRun = { name: string; status: string; conclusion: string | null; output?: { title?: string | null; summary?: string | null; text?: string | null }; html_url?: string };
type Comment = { id: number; body: string; user?: { login?: string; type?: string }; path?: string; line?: number | null; original_line?: number | null; diff_hunk?: string };

export function startPrWatch(ms: number) {
  let running = false;
  const tick = async () => {
    // Đang tắt để nhường bản mới (drain.ts): không mở lượt sửa CI mới.
    if (running || isDraining()) return;
    running = true;
    try { await checkAll(); } catch (e) { console.error("[prwatch]", e); } finally { running = false; }
  };
  setTimeout(tick, Math.min(ms, 10_000));
  setInterval(tick, ms);
}

export async function checkAll() {
  for (const pr of openPrs()) {
    const prefs = getPrefs(pr.user_id);
    if (!prefs.autoFix && !prefs.autoArchivePr) continue;
    const user = getUser(pr.user_id);
    const link = user ? getLink(user.id) : null;
    if (!user || !link || link.broken) continue;
    try { await checkPr(user, link.token, link.login, pr); }
    catch (e) { console.warn(`[prwatch] ${pr.repo}#${pr.number}:`, (e as Error).message); }
    patchPr(pr.user_id, pr.repo, pr.number, { checked_at: Date.now() });
  }
}

async function checkPr(user: UserRow, token: string, me: string, pr: PrRow) {
  const prefs = getPrefs(user.id);
  const info = await gh<Pull>(token, `/repos/${pr.repo}/pulls/${pr.number}`);
  if (info.state === "closed") {
    patchPr(user.id, pr.repo, pr.number, { state: info.merged ? "merged" : "closed", note: info.merged ? "Đã gộp" : "Đã đóng" });
    if (prefs.autoArchivePr) await archiveAfterPr(user, token, pr, info);
    return;
  }
  const sha = info.head.sha;
  if (sha !== pr.head_sha) patchPr(user.id, pr.repo, pr.number, { head_sha: sha });
  const key = `${user.id}:${pr.repo}#${pr.number}`;
  if (!prefs.autoFix || busy.has(key)) return;
  if (!prefs.allowBypass) { patchPr(user.id, pr.repo, pr.number, { note: "Bật \"Cho phép chế độ Tự động\" để Synchro tự sửa PR (lượt chạy nền không có ai bấm duyệt)." }); return; }
  if (!wsAllowed(user)) return;
  if (pr.fixes >= MAX_RUNS) return;

  const tasks: string[] = [];
  let label = "";
  // CI: chỉ xử lý khi mọi lượt kiểm tra của commit mới nhất đã chạy xong và có lượt lỗi.
  const runs = (await gh<{ check_runs: CheckRun[] }>(token, `/repos/${pr.repo}/commits/${sha}/check-runs?per_page=50`)).check_runs ?? [];
  const failed = runs.filter((r) => r.status === "completed" && ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(String(r.conclusion)));
  const ciFixes = pr.ci_fixes;
  if (runs.length && runs.every((r) => r.status === "completed") && failed.length && pr.fixed_sha !== sha) {
    if (ciFixes >= MAX_CI_FIXES) {
      patchPr(user.id, pr.repo, pr.number, { fixed_sha: sha, note: `CI vẫn lỗi sau ${ciFixes} lần tự sửa, chờ bạn xem` });
      patchSession(user.id, pr.sid, { state: "blocked", reason: `CI của PR #${pr.number} vẫn lỗi, cần bạn xem` });
    } else {
      tasks.push(`CI của commit ${sha.slice(0, 7)} lỗi:\n${failed.map((r) => `- ${r.name}: ${r.conclusion}${r.output?.title ? ` — ${r.output.title}` : ""}${r.output?.summary ? `\n${String(r.output.summary).slice(0, 1500)}` : ""}${r.output?.text ? `\n${String(r.output.text).slice(0, 2500)}` : ""}`).join("\n")}`);
      label = `CI lỗi (${failed.map((r) => r.name).join(", ").slice(0, 60)})`;
    }
  }
  // Góp ý mới (bình luận chung và bình luận trên dòng code), trừ lời trả lời của chính Synchro và của bot.
  const [issue, review] = await Promise.all([
    gh<Comment[]>(token, `/repos/${pr.repo}/issues/${pr.number}/comments?per_page=100`),
    gh<Comment[]>(token, `/repos/${pr.repo}/pulls/${pr.number}/comments?per_page=100`),
  ]);
  const fresh = [...issue, ...review].filter((c) => c.id > pr.seen_comment && !c.body?.includes(MARK) && c.user?.type !== "Bot").sort((a, b) => a.id - b.id);
  const seen = Math.max(pr.seen_comment, ...[...issue, ...review].map((c) => c.id));
  if (fresh.length) {
    tasks.push(`Góp ý mới trên PR:\n${fresh.map((c) => `- ${c.user?.login === me ? "Bạn" : `@${c.user?.login ?? "?"}`}${c.path ? ` (tệp ${c.path}${c.line ?? c.original_line ? `, dòng ${c.line ?? c.original_line}` : ""})` : ""}: ${String(c.body).slice(0, 2000)}`).join("\n")}`);
    label = label ? `${label}, ${fresh.length} góp ý` : `${fresh.length} góp ý mới`;
  }
  if (seen !== pr.seen_comment) patchPr(user.id, pr.repo, pr.number, { seen_comment: seen });
  if (!tasks.length) return;
  busy.add(key);
  patchPr(user.id, pr.repo, pr.number, { busy: 1, ...(failed.length ? { fixed_sha: sha } : {}) });
  fixPr(user, token, pr, info, tasks, label, failed.length > 0)
    .catch((e) => {
      console.warn(`[prwatch] tự sửa ${pr.repo}#${pr.number}:`, (e as Error).message);
      patchSession(user.id, pr.sid, { state: "blocked", reason: `Tự sửa PR #${pr.number} lỗi: ${(e as Error).message}`.slice(0, 120) });
    })
    .finally(() => { busy.delete(key); patchPr(user.id, pr.repo, pr.number, { busy: 0 }); });
}

// Lịch sử của phiên (nhánh đang chọn) làm ngữ cảnh cho lượt tự sửa.
function historyOf(data: Record<string, unknown> | null) {
  const nodes = ((data?.nodes as { id: number; parent: number; user?: string; hid?: string; ai?: string }[] | undefined) ?? []);
  const sel = (data?.sel as Record<number, number> | undefined) ?? {};
  const path: typeof nodes = [];
  let p = 0;
  for (;;) {
    const kids = nodes.filter((n) => n.parent === p);
    if (!kids.length) break;
    const n = kids.find((k) => k.id === sel[p]) ?? kids[kids.length - 1];
    path.push(n); p = n.id;
  }
  return path.slice(-10).flatMap((n) => [{ role: "user", content: `${n.user ?? ""}${n.hid ? `\n\n${n.hid}` : ""}` }, ...(n.ai ? [{ role: "assistant", content: n.ai }] : [])]);
}

type Step = { k: "text"; text: string } | { k: "think"; text: string } | { k: "tool"; id: string; name: string; input: Record<string, unknown>; done?: boolean; ok?: boolean; summary?: string; output?: string; diff?: unknown };
async function fixPr(user: UserRow, token: string, pr: PrRow, info: Pull, tasks: string[], label: string, ci: boolean) {
  const d = sdir(pr.sid), branch = info.head.ref;
  const auth = gitAuth(token);
  // Workspace của phiên về đúng nhánh của PR, lấy commit mới nhất (người khác có thể đã đẩy thêm).
  const prep = await exec(user.id, d, { cmd: `${auth.prelude}git fetch -q origin "$BR" 2>&1 && git checkout -q "$BR" 2>&1 && git pull -q --ff-only origin "$BR" 2>&1${auth.epilogue}`, env: { ...auth.env, BR: branch }, stdin: auth.stdin, timeout: 180 });
  if (prep.code) throw new Error(`không chuẩn bị được nhánh ${branch}: ${(prep.out + prep.err).trim().slice(-200)}`);
  const sess = getSession(user.id, pr.sid);
  const style = isStyle((sess?.data as { style?: unknown } | null)?.style) ? STYLE_SYS[(sess!.data as { style: "default" | "explain" | "learn" }).style] : "";
  const prompt = `[Tự sửa PR #${pr.number}] ${tasks.join("\n\n")}

Bạn đang ở nhánh ${branch} của pull request ${info.html_url}. Hãy:
1. Tìm nguyên nhân (đọc log, tệp liên quan, chạy lại kiểm thử nếu có).
2. Sửa cho đúng; xử lý từng góp ý (đổi code nếu góp ý hợp lý, còn câu hỏi thì trả lời).
3. Chạy lại kiểm thử liên quan, rồi git commit với nội dung rõ ràng. Không push: Synchro tự push khi bạn xong.
4. Kết thúc bằng tóm tắt ngắn cho người review: đã sửa gì, vì sao; trả lời từng góp ý nếu có.`;
  // Model của phiên (model bạn đang dùng ở phiên đó), không có thì để Synchro tự chọn.
  const sm = (sess?.data as { model?: unknown } | null)?.model;
  const pick = await pickAgentModel(user, typeof sm === "string" && sm ? sm : AUTO, [{ role: "user", content: prompt }], "auto");
  if ("error" in pick) throw new Error(pick.error);
  const nid = appendNode(user.id, pr.sid, { user: `Tự sửa PR #${pr.number}: ${label}`, hid: prompt, atts: [], ai: "", done: false, mode: "auto", time: Date.now(), auto: true, steps: [] });
  patchSession(user.id, pr.sid, { state: null, reason: `Đang tự sửa PR #${pr.number}` });
  const steps: Step[] = [];
  let last = 0;
  const flush = (force = false) => {
    if (!force && Date.now() - last < 1500) return;
    last = Date.now();
    updateNode(user.id, pr.sid, nid, (n) => ({ ...n, steps: [...steps], ai: steps.filter((x) => x.k === "text").map((x) => (x as { text: string }).text).join("\n\n") }));
  };
  const emit = (e: AgentEvent) => {
    if (e.t === "text") steps.push({ k: "text", text: e.text });
    else if (e.t === "think") steps.push({ k: "think", text: e.text });
    else if (e.t === "tool") steps.push({ k: "tool", id: e.id, name: e.name, input: e.input });
    else if (e.t === "result") { const s = steps.find((x) => x.k === "tool" && x.id === e.id) as Extract<Step, { k: "tool" }> | undefined; if (s) Object.assign(s, { done: true, ok: e.ok, summary: e.summary, output: e.output?.slice(0, 4000), diff: e.diff }); }
    else return;
    flush();
  };
  const ac = new AbortController();
  // Việc nền cũng là một CLI: tính vào mức của tài khoản và của cả máy như lượt Code người dùng gửi. Chờ quá lâu thì lần kiểm tra PR sau làm lại.
  const slot = await acquire({ uid: user.id, lane: "code", limit: MAX_LIVE_RUNS, total: turnsTotal(user), signal: ac.signal, maxWaitMs: 10 * 60_000 });
  if (typeof slot === "string") throw new Error("máy chủ đang bận");
  const out = await withSlot(slot, () => withUsage(user.id, "code", () => runAgentTurn({ user, sid: pr.sid, pick, system: `Bạn đang tự sửa pull request khi người dùng vắng mặt: không hỏi lại người dùng, tự quyết theo hướng an toàn nhất.${style ? `\n\n${style}` : ""}`,
    messages: [...historyOf(sess?.data ?? null), { role: "user", content: prompt }], skills: true, emit, signal: ac.signal, perm: { mode: "auto", allow: [] } })));
  flush(true);
  // Có commit mới: đẩy lên nhánh của PR và trả lời trên PR.
  const ahead = Number((await exec(user.id, d, { cmd: "git rev-list --count @{u}..HEAD 2>/dev/null || echo 0", timeout: 20 })).out.trim()) || 0;
  let pushed = false;
  if (ahead > 0) {
    const r = await exec(user.id, d, { cmd: `${auth.prelude}git push -q origin HEAD 2>&1${auth.epilogue}`, env: auth.env, stdin: auth.stdin, timeout: 180 });
    if (r.code) throw new Error(`push lỗi: ${(r.out + r.err).trim().slice(-200)}`);
    pushed = true;
  }
  // Phiên có kết quả ngay (danh sách phiên ở mọi thiết bị), rồi mới trả lời trên PR.
  updateNode(user.id, pr.sid, nid, (n) => ({ ...n, done: true, ai: out.text || n.ai }));
  patchSession(user.id, pr.sid, { state: pushed ? "review" : "done", reason: pushed ? `Đã tự sửa PR #${pr.number}, chờ CI` : `Đã xem PR #${pr.number}, không cần đổi code` });
  const commits = pushed ? (await exec(user.id, d, { cmd: `git log --format="- %h %s" -${Math.min(ahead, 10)}`, timeout: 20 })).out.trim() : "";
  const body = `${MARK}\n🤖 **Synchro Code** ${pushed ? `đã đẩy ${ahead} commit để xử lý ${ci ? "CI lỗi" : "góp ý"}` : "đã xem"}:\n\n${out.text.trim().slice(0, 6000) || "(không có tóm tắt)"}${commits ? `\n\n${commits}` : ""}`;
  await gh(token, `/repos/${pr.repo}/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body }) }).catch((e) => console.warn("[prwatch] bình luận", (e as Error).message));
  patchPr(user.id, pr.repo, pr.number, { fixes: pr.fixes + 1, ci_fixes: pr.ci_fixes + (ci ? 1 : 0), note: pushed ? `Đã tự sửa và đẩy ${ahead} commit lúc ${hhmm()}` : `Đã xem, không cần đổi code lúc ${hhmm()}` });
  // Gợi ý câu nhắn tiếp cho lần bạn mở lại phiên.
  const m = await sessionMeta(user, { d, ask: prompt, reply: out.text }).catch(() => null);
  if (m?.suggest) patchSession(user.id, pr.sid, { suggest: m.suggest });
}

async function archiveAfterPr(user: UserRow, token: string, pr: PrRow, info: Pull) {
  patchSession(user.id, pr.sid, { archived: true, state: "done", reason: info.merged ? `PR #${pr.number} đã gộp` : `PR #${pr.number} đã đóng` });
  if (!info.merged) return;
  const branch = info.head.ref;
  if (branch && branch !== info.base.ref) await gh(token, `/repos/${pr.repo}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" }).catch(() => {});
  // Dọn thư mục phiên khi mọi thay đổi đã nằm trên GitHub (không còn tệp chưa commit, không còn commit chưa đẩy).
  if (!wsAllowed(user)) return;
  const d = sdir(pr.sid);
  const st = await exec(user.id, d, { cmd: 'echo "$(git status --porcelain 2>/dev/null | wc -l | tr -d " ") $(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"', timeout: 20 }).catch(() => null);
  const [dirty, ahead] = (st?.out.trim() ?? "1 1").split(" ").map(Number);
  if (st && !st.code && dirty === 0 && ahead === 0) await exec(user.id, d, { cmd: 'cd .. && rm -rf -- "$D"', env: { D: d }, timeout: 60 }).catch(() => {});
}
