// Hồ tiến trình Claude Code khởi động sẵn (--input-format stream-json): tiến trình đọc xong cấu hình rồi đứng chờ tin nhắn ở stdin, nên lượt chat không
// phải chờ khoảng 1,7 giây khởi động CLI (đo trên máy chủ thật). Mỗi tiến trình gắn chặt với một tài khoản, model, nỗ lực và hướng dẫn hệ thống (các cờ đó chỉ
// đọc lúc khởi động), nên khóa gồm cả đăng nhập: tài khoản này không bao giờ dùng trúng tiến trình của tài khoản khác. Chỉ dùng cho lượt không cầu nối MCP.
// Giới hạn: số tiến trình toàn máy, số tiến trình mỗi tài khoản, thời gian rảnh, tuổi thọ, bộ nhớ. Hỏng kiểu gì thì lượt rơi về cách cũ (mỗi lượt một tiến trình);
// hỏng liên tiếp (CLI đổi hành vi) thì tạm tắt cả hồ. Synchro tắt thì stdin đóng, CLI tự thoát; không có tiến trình mồ côi.
// SYNCHRO_CLAUDE_POOL_MAX: số tiến trình tối đa (0 là tắt hẳn).
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import { registerIdle, warmRoom } from "../turngate";
import { spawnCli, type Exit, type Proc } from "./cli_runtime";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type PoolSpec = { bin: string; args: string[]; env: Record<string, string>; cwd: string; account: string };
type Entry = { key: string; spec: PoolSpec; proc: Proc; session: string | null; busy: boolean; stale: boolean; born: number; used: number; everUsed: boolean; gone: boolean; dropped: boolean; q: Json[]; wake: (() => void) | null };

const envNum = (k: string, d: number) => { const n = Number(process.env[k]); return process.env[k] !== undefined && Number.isFinite(n) && n >= 0 ? n : d; };
const maxTotal = () => envNum("SYNCHRO_CLAUDE_POOL_MAX", 6);
const PER_ACCOUNT = 3;
const IDLE_MS = 10 * 60_000, LIFE_MS = 60 * 60_000;
const MAX_RSS_KB = 700 * 1024, MIN_FREE = 800 * 1024 * 1024;
const STRIKES = 3, STRIKE_WINDOW = 10 * 60_000, PAUSE_MS = 30 * 60_000;

type G = { entries: Set<Entry>; strikes: number[]; pausedUntil: number; sweep: NodeJS.Timeout | null };
const g: G = ((globalThis as { __synchroClaudePool?: G }).__synchroClaudePool ??= { entries: new Set(), strikes: [], pausedUntil: 0, sweep: null });

const poolKey = (s: PoolSpec) => crypto.createHash("sha256").update(JSON.stringify([s.bin, s.args, s.cwd, Object.entries(s.env).sort()])).digest("hex");
// macOS tính "free" rất thấp dù còn nhiều bộ nhớ; Linux trả MemAvailable.
const lowMem = () => process.platform === "linux" && os.freemem() < MIN_FREE;
export const poolOn = () => maxTotal() > 0 && Date.now() >= g.pausedUntil;
const usable = (e: Entry) => !e.gone && !e.dropped && !e.stale && Date.now() - e.born < LIFE_MS;
const idlest = () => [...g.entries].filter((e) => !e.busy).sort((a, b) => a.used - b.used);

function drop(e: Entry) {
  if (e.dropped) return;
  e.dropped = true;
  g.entries.delete(e);
  e.proc.kill();
}
// Cổng lượt tính tiến trình rảnh vào mức của cả máy: lượt thật cần chỗ thì tiến trình rảnh lâu nhất nhường.
registerIdle({ count: () => idlest().length, evict: () => { const v = idlest()[0]; if (v) drop(v); return !!v; } });
/** Tiến trình hỏng hoặc CLI không làm đúng như kỳ vọng: đếm; nhiều lần liên tiếp thì tạm tắt hồ, mọi lượt quay về cách mỗi lượt một tiến trình. */
export function poolStrike(why: string) {
  const now = Date.now();
  g.strikes = [...g.strikes.filter((t) => now - t < STRIKE_WINDOW), now];
  console.warn(`[pool] claude: ${why} (${g.strikes.length}/${STRIKES})`);
  if (g.strikes.length < STRIKES) return;
  g.strikes = []; g.pausedUntil = now + PAUSE_MS;
  for (const e of [...g.entries]) if (!e.busy) drop(e);
  console.warn(`[pool] claude: tạm tắt hồ tiến trình ${PAUSE_MS / 60_000} phút`);
}

function launch(spec: PoolSpec, resume?: string): Entry {
  const proc = spawnCli(spec.bin, [...spec.args, ...(resume ? ["--resume", resume] : [])], { env: spec.env, cwd: spec.cwd });
  const e: Entry = { key: poolKey(spec), spec, proc, session: resume ?? null, busy: false, stale: false, born: Date.now(), used: Date.now(), everUsed: false, gone: false, dropped: false, q: [], wake: null };
  g.entries.add(e);
  // Đọc liên tục ngay từ đầu: readline bỏ mất các dòng tới trước khi có người đọc. Chỉ giữ dòng của lượt đang chạy.
  void (async () => {
    for await (const l of proc.lines) {
      const t = l.trim();
      if (!e.busy || !t.startsWith("{")) continue;
      try { e.q.push(JSON.parse(t) as Json); e.wake?.(); } catch {}
    }
  })().catch(() => {});
  void proc.done.then((x) => {
    e.gone = true; g.entries.delete(e); e.wake?.();
    // Chết khi chưa ai dùng mà không phải do Synchro tắt: thường là cờ không còn được CLI nhận.
    if (!e.dropped && !e.everUsed && x.code) poolStrike(`tiến trình đợi sẵn thoát với mã ${x.code}`);
  });
  startSweep();
  return e;
}
/** Dọn chỗ cho một tiến trình mới. evict: được đuổi tiến trình rảnh của tài khoản khác (có lượt thật đang cần); khởi động sẵn thì không. */
function makeRoom(account: string, evict: boolean) {
  const idle = (mine: boolean) => [...g.entries].filter((e) => !e.busy && (!mine || e.spec.account === account)).sort((a, b) => a.used - b.used);
  while ([...g.entries].filter((e) => e.spec.account === account).length >= PER_ACCOUNT) { const v = idle(true)[0]; if (!v) return false; drop(v); }
  while (g.entries.size >= maxTotal()) { const v = evict ? idle(false)[0] : undefined; if (!v) return false; drop(v); }
  return true;
}
function sweep() {
  const now = Date.now();
  for (const e of [...g.entries]) if (!e.busy && (now - e.used > IDLE_MS || now - e.born > LIFE_MS)) drop(e);
  // Thiếu bộ nhớ: bỏ một nửa số tiến trình rảnh, từ tiến trình lâu chưa dùng. Mỗi lần một tiến trình, 30 giây một lần thì không kịp khi các lượt đang chạy lớn dần.
  if (lowMem()) { const v = idlest(); for (const e of v.slice(0, Math.ceil(v.length / 2))) drop(e); }
  if (!g.entries.size) return;
  // Bộ nhớ từng tiến trình (cả cây con: sudo, bwrap, node): đọc ở nền để không chặn các lượt khác.
  execFile("ps", ["-A", "-o", "pid=,ppid=,rss="], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) return;
    const kids = new Map<number, number[]>(), rss = new Map<number, number>();
    for (const l of out.split("\n")) {
      const [p, pp, r] = l.trim().split(/\s+/).map(Number);
      if (!p) continue;
      rss.set(p, r || 0);
      const k = kids.get(pp) ?? []; k.push(p); kids.set(pp, k);
    }
    for (const e of [...g.entries]) {
      if (e.busy || !e.proc.child.pid) continue;
      let sum = 0;
      for (const st = [e.proc.child.pid]; st.length;) { const p = st.pop()!; sum += rss.get(p) ?? 0; st.push(...(kids.get(p) ?? [])); }
      if (sum > MAX_RSS_KB) { console.warn(`[pool] claude: tắt tiến trình dùng ${Math.round(sum / 1024)} MB`); drop(e); }
    }
  });
}
function startSweep() {
  if (g.sweep) return;
  g.sweep = setInterval(sweep, 30_000);
  g.sweep.unref?.();
}

export type TurnEnd = "done" | "aborted" | "silent" | "died";
export type Lease = {
  /** Có sẵn tiến trình đang chờ (true) hay vừa phải khởi động (false). */
  hit: boolean;
  proc: Proc;
  send: (line: string) => void;
  /** Sự kiện của lượt này, kết thúc ở "result". firstMs: không có dòng nào sau chừng này thì coi như CLI không xử lý được stream-json. */
  events: (signal: AbortSignal | undefined, firstMs: number) => AsyncGenerator<Json, void, unknown>;
  ended: () => TurnEnd | null;
  /** Lượt xong tốt: giữ tiến trình cho câu tiếp theo của đoạn chat này. */
  release: (session: string | null) => void;
  /** Bỏ tiến trình (lỗi, Dừng, lượt báo lỗi). */
  discard: () => void;
  done: () => Promise<Exit>;
};

/** Lấy tiến trình cho một lượt: đang chờ sẵn đúng phiên (hoặc chưa gắn phiên nào cho đoạn chat mới), không có thì khởi động mới. null: hồ đã đầy, dùng cách cũ. */
export function takeProcess(spec: PoolSpec, resume?: string): Lease | null {
  if (!poolOn()) return null;
  const key = poolKey(spec);
  let e = [...g.entries].find((x) => x.key === key && !x.busy && usable(x) && x.session === (resume ?? null));
  const hit = !!e;
  if (!e) { if (!makeRoom(spec.account, true)) return null; e = launch(spec, resume); }
  const it = e;
  it.busy = true; it.everUsed = true; it.used = Date.now(); it.q.length = 0;
  let end: TurnEnd | null = null, finished = false;
  const close = () => { finished = true; it.busy = false; it.used = Date.now(); };
  return {
    hit, proc: it.proc,
    send: (line) => it.proc.write(line),
    ended: () => end,
    release: (session) => { if (finished) return; close(); if (session) it.session = session; if (it.gone || it.stale) drop(it); },
    discard: () => { if (finished && it.dropped) return; close(); drop(it); },
    done: () => it.proc.done,
    events: async function* (signal, firstMs) {
      const t0 = Date.now();
      let any = false;
      for (;;) {
        if (signal?.aborted) { end = "aborted"; return; }
        const o = it.q.shift();
        if (o) {
          any = true;
          yield o;
          if (o.type === "result") { end = "done"; return; }
          continue;
        }
        if (it.gone) { end = "died"; return; }
        if (!any && Date.now() - t0 > firstMs) { end = "silent"; return; }
        await new Promise<void>((ok) => {
          const t = setTimeout(fin, 500);
          function fin() { clearTimeout(t); it.wake = null; signal?.removeEventListener("abort", fin); ok(); }
          it.wake = fin;
          signal?.addEventListener("abort", fin, { once: true });
        });
      }
    },
  };
}
/** Khởi động sẵn một tiến trình cho đoạn chat mới kế tiếp, nếu còn chỗ và còn bộ nhớ. Không tốn lượt nào của gói: chưa có tin nhắn thì CLI chưa gọi model. */
export function prestart(spec: PoolSpec) {
  if (!poolOn() || lowMem()) return;
  const key = poolKey(spec);
  // Đã có sẵn: người dùng còn ở trang thì giữ nó khỏi bị dọn vì rảnh (mở tab mười phút rồi mới gõ câu đầu không phải khởi động lại).
  const have = [...g.entries].find((x) => x.key === key && !x.busy && usable(x) && x.session === null);
  if (have) { have.used = Date.now(); return; }
  if (warmRoom() && makeRoom(spec.account, false)) launch(spec);
}
/** Có lượt chạy kiểu khác nối tiếp phiên này (lượt có công cụ): tiến trình đang giữ phiên đó không còn biết hết hội thoại, không được dùng lại. */
export function forgetSession(account: string, session: string) {
  for (const e of [...g.entries]) if (e.spec.account === account && e.session === session) { if (e.busy) e.stale = true; else drop(e); }
}
/** Đăng xuất, đăng nhập lại, token bị thu hồi: tắt mọi tiến trình của tài khoản (chúng giữ đăng nhập cũ). */
export function dropAccount(account: string) {
  for (const e of [...g.entries]) if (e.spec.account === account) { if (e.busy) e.stale = true; else drop(e); }
}
export const poolSize = () => g.entries.size;
export function dropAll() { for (const e of [...g.entries]) drop(e); g.strikes = []; g.pausedUntil = 0; }
