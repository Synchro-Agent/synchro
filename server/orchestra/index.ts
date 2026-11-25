// Orchestra trong lượt chat thật: quyết định có chia không (luật rẻ, decide.ts), dựng đội từ các model người dùng đang
// dùng được, chạy nhóm (engine.ts) bằng đúng đường gọi model của Synchro (gói subscription qua CLI chính chủ, khóa API
// qua llmcall), báo sơ đồ tổ chức lên khung chat qua sự kiện "orch" của lượt chạy, và học dần hồ sơ năng lực từ kết quả
// thật. Câu trả lời cuối do trưởng nhóm viết bằng đường chat đầy đủ (chat/routing.ts) nên có đủ công cụ, artifact, tệp,
// chữ hiện dần như mọi lượt khác.
import "server-only";
import type { UserRow } from "../authstore";
import { permsOf } from "../authstore";
import { clampEffort, effortCap } from "../../shared/catalog";
import { codeOnly, isFrontier } from "../../shared/modelrules";
import { vendorOf } from "../../shared/vendor";
import { billsCredit, tierOf, type RouteInput } from "../router";
import { resolveModel } from "../providers";
import { chatOnce } from "../llmcall";
import { overLimit, priceOf, usageScope } from "../usage";
import { helperRoom, subCli, subTurn } from "../ai/subs";
import { progress, turnSignal } from "../runs";
import { getSetting, setSetting } from "../db/settings";
import { capsOf, noteStat, type Learned, type Skill } from "./profile";
import { pickTeam, type Member } from "./assign";
import { contextOf, estTokens, orchestrate, teamBlock, type Budget, type CallIn, type CallOut } from "./engine";
export { finishState, withTeam } from "./engine";
import { shouldSplit } from "./decide";
import type { OrchState } from "../../shared/orchestra";

// Hồ sơ học được: một bảng nhỏ cho cả máy chủ (năng lực của model không đổi theo người dùng), giữ trong settings.
const LEARN_KEY = "orchestra_learned";
const g = globalThis as { __synchroOrchLearned?: Learned };
function learned(): Learned {
  if (g.__synchroOrchLearned) return g.__synchroOrchLearned;
  try {
    g.__synchroOrchLearned = JSON.parse(getSetting(LEARN_KEY, "{}")) as Learned;
  } catch (e) {
    console.warn("[orchestra] bảng học hỏng, bắt đầu lại:", (e as Error).message);
    g.__synchroOrchLearned = {};
  }
  return g.__synchroOrchLearned;
}
function learn(key: string, needs: Skill[], ok: boolean, ms: number) {
  g.__synchroOrchLearned = noteStat(learned(), key, needs, ok, ms);
  try { setSetting(LEARN_KEY, JSON.stringify(g.__synchroOrchLearned)); }
  catch (e) { console.warn("[orchestra] chưa lưu được bảng học (giữ trong bộ nhớ):", (e as Error).message); }
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : d;
};
/**
 * Trần cho mỗi việc: tiền khóa API (mặc định 0,4 USD, gói subscription không tính tiền), số lời gọi model, thời gian.
 * Autopilot không ai ngồi chờ nên được lâu hơn. Số nhánh chạy cùng lúc thấp vì mỗi nhánh trên gói là một CLI riêng trên
 * máy chủ.
 */
export const budgetOf = (autopilot: boolean): Budget => ({
  maxUsd: num(process.env.SYNCHRO_ORCH_MAX_USD, 0.4),
  maxCalls: num(process.env.SYNCHRO_ORCH_MAX_CALLS, 16),
  deadlineMs: num(process.env.SYNCHRO_ORCH_DEADLINE_MS, autopilot ? 15 * 60_000 : 8 * 60_000),
  parallel: num(process.env.SYNCHRO_ORCH_PARALLEL, 3),
});

const LEVEL = { fast: 0, balanced: 1, strong: 2 } as const;
/** Một thành viên tiềm năng: hồ sơ năng lực, giá ước tính, gói còn hạn mức không. */
export function memberOf(user: UserRow, key: string, l: Learned = learned()): Member {
  const cli = subCli(key);
  const price = cli ? null : priceOf(key);
  // Gói gần chạm giới hạn (từ 70%) hay đang bị chặn: phần còn lại dành cho tin nhắn của chính người dùng. Hết ngân sách
  // việc phụ trong ngày thì không tính: Orchestra là việc người dùng đang chờ, không phải việc nền.
  const room = cli ? helperRoom(user.id, cli) : null;
  return {
    key, vendor: vendorOf(key), cli, level: isFrontier(key) ? 3 : LEVEL[tierOf(key)], caps: capsOf(key, l),
    usdPer1k: price ? (price.in * 0.6 + price.out * 0.4) / 1000 : 0, low: !!room && !room.ok && room.why !== "budget",
    credit: billsCredit(key), codeOnly: codeOnly(key), steady: !/^sub-agy\//.test(key),
  };
}

/**
 * Một lời gọi của thành viên: gói qua CLI (một lượt riêng, có tìm web khi cần), khóa API qua llmcall (tính vào hạn mức
 * chi phí).
 */
async function callModel(user: UserRow, c: CallIn): Promise<CallOut> {
  const ctl = new AbortController(), turn = turnSignal();
  const stop = () => ctl.abort();
  turn?.addEventListener("abort", stop, { once: true });
  let late = false;
  const timer = setTimeout(() => { late = true; ctl.abort(); }, c.timeoutMs);
  try {
    if (subCli(c.model)) {
      const r = await subTurn({
        user, model: c.model, system: c.system, messages: [{ role: "user", content: c.prompt }], effort: c.effort,
        signal: ctl.signal, job: c.job, web: c.web, ephemeral: true,
      });
      const j = r.json as { text?: unknown; error?: unknown; cancelled?: boolean };
      if (late) throw new Error(`Quá ${Math.round(c.timeoutMs / 1000)} giây chưa xong.`);
      if (r.status !== 200 || typeof j.text !== "string" || j.cancelled) {
        throw new Error(String(j.error ?? `Gói trả lỗi ${r.status}.`));
      }
      return { text: j.text, tokens: estTokens(c.system + c.prompt) + estTokens(j.text), usd: 0 };
    }
    const over = overLimit(user, "task");
    if (over) throw new Error(over);
    const t = await resolveModel(c.model);
    if (!t) throw new Error("Model này không còn dùng được.");
    const effort = clampEffort(c.effort, effortCap(permsOf(user).effort, c.model), t.kind);
    let tok = 0, usd = 0;
    const tap = (n: number, cost: number) => { tok += n; usd += cost; };
    const ask = [{ role: "user" as const, content: c.prompt }];
    const text = await usageScope.run({ uid: user.id, feature: "chat", tap },
      () => chatOnce(t, c.system, ask, c.maxTokens, ctl.signal, effort));
    return { text, tokens: tok || estTokens(c.system + c.prompt) + estTokens(text), usd };
  } catch (e) {
    if (late) throw new Error(`Quá ${Math.round(c.timeoutMs / 1000)} giây chưa xong.`);
    throw e;
  } finally {
    clearTimeout(timer);
    turn?.removeEventListener("abort", stop);
  }
}

export type OrchTurn = { boss: string; block: string; state: OrchState; models: number };

/**
 * Chạy nhóm cho một lượt Tự động. null: lượt này không chia (câu đơn giản, ít model, trưởng nhóm thấy không có nhánh,
 * hay cả nhóm không làm xong): lượt chạy một model như trước. "cancelled": người dùng bấm Dừng giữa chừng.
 */
type TurnIn = {
  user: UserRow; q: RouteInput; messages: unknown; pool: string[]; autopilot: boolean; name: (k: string) => string;
  /** Model bộ định tuyến chọn cho lượt này: làm trưởng nhóm khi đủ mạnh. */
  routed?: string;
};
export async function orchestraTurn(o: TurnIn): Promise<OrchTurn | "cancelled" | null> {
  const dec = shouldSplit(o.q, { pool: o.pool.length, autopilot: o.autopilot });
  if (!dec.split) return null;
  const l = learned();
  const members = o.pool.map((k) => memberOf(o.user, k, l));
  const team = pickTeam(members, o.routed);
  if (!team) return null;
  const why = { branches: dec.branches, boss: team.boss, manager: team.manager, pool: o.pool.length };
  console.log(`[orchestra] ${JSON.stringify(why)}`);
  const job = { ask: o.q.text, context: contextOf(o.messages), pool: members, team, budget: budgetOf(o.autopilot) };
  const out = await orchestrate(job, {
    call: (c) => callModel(o.user, c),
    emit: (s) => { progress("orch", JSON.stringify(s)); },
    status: (t) => { progress("step", t); },
    name: o.name, learn, aborted: () => !!turnSignal()?.aborted,
  });
  if (!out.ok) return out.why === "aborted" ? "cancelled" : null;
  const models = new Set([out.boss, ...out.state.tasks.map((t) => t.model)]).size;
  return { boss: out.boss, block: teamBlock(out.plan, out.results), state: out.state, models };
}
