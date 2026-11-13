// Ping ngoài mỗi phút cho synchro.net.nz (Blueprint A6.4): Cloudflare Worker có lịch "* * * * *" (gói Workers Free: lịch mỗi phút, 100.000 lần gọi
// mỗi ngày — ở đây 1.440). Máy chủ không tự báo được khi chính nó chết, nên việc kiểm nằm ở Cloudflare, ngoài VPS.
// Báo động: không tự gửi thư. Khi /api/health lỗi FAILS_TO_ALERT phút liền, Worker kích workflow .github/workflows/uptime.yml (workflow_dispatch);
// workflow đó kiểm lại từ máy của GitHub, lỗi thật thì job đỏ và GitHub gửi email "Run failed" cho chủ repo. Mỗi lần báo chỉ tốn 1 phút Actions,
// khác với chạy cron trên GitHub mỗi 5 phút (≈8.640 phút / tháng, vượt hạn mức 2.000 phút của repo riêng tư gói Free).
// Trạng thái (số phút lỗi liền, đã báo chưa) nằm trong KV UPTIME; chỉ ghi khi trạng thái đổi, nên mất điện cả ngày cũng chỉ vài lần ghi (KV Free: 1.000 lần ghi / ngày).
// Cài đặt và bí mật: docs/van-hanh.md → "Theo dõi ngoài". Kiểm thử: tests/api/uptime-worker.test.mjs (không cần Cloudflare).

const DEFAULT_URL = "https://synchro.net.nz/api/health";
const UA = "SynchroUptimeWorker/1.0";

/** Đọc kết quả /api/health: đạt khi HTTP 200, "db" đúng và "agent" không phải false (null = máy không bật workspace, vẫn là ổn). */
export function judge(status, text) {
  let j = null;
  try { j = JSON.parse(text); } catch { /* không phải JSON */ }
  if (status !== 200) return { ok: false, why: `HTTP ${status}${j && typeof j === "object" ? ` db=${j.db} agent=${j.agent}` : ""}` };
  if (!j || typeof j !== "object") return { ok: false, why: "HTTP 200 nhưng không phải JSON" };
  if (j.db !== true) return { ok: false, why: `db=${j.db}` };
  if (j.agent === false) return { ok: false, why: "agent=false" };
  return { ok: true, why: `ok build=${j.build ?? "?"}` };
}

/** Một lần gọi /api/health, hết giờ sau timeoutMs. Không ném lỗi: lỗi mạng cũng là một kết quả "lỗi". */
export async function probe(fetchImpl, url, timeoutMs = 15_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { "user-agent": UA, "cache-control": "no-cache" }, signal: ac.signal, cf: { cacheTtl: 0 } });
    return judge(r.status, await r.text());
  } catch (e) {
    return { ok: false, why: `không gọi được: ${String(e?.name === "AbortError" ? `quá ${timeoutMs / 1000} giây` : e?.message ?? e).slice(0, 160)}` };
  } finally { clearTimeout(t); }
}

/** Kích workflow uptime.yml trên GitHub. Token: fine-grained, chỉ repo này, quyền "Actions: Read and write" (không cần quyền ghi mã). */
export async function dispatch(env, fetchImpl, kind, why) {
  const repo = env.GH_REPO, wf = env.GH_WORKFLOW || "uptime.yml";
  if (!repo || !env.GH_TOKEN) return { ok: false, why: "thiếu GH_REPO hoặc bí mật GH_TOKEN" };
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": UA, "content-type": "application/json" },
      body: JSON.stringify({ ref: env.GH_REF || "main", inputs: { reason: `${kind}: ${why}`.slice(0, 900) } }),
    });
    return r.status === 204 ? { ok: true } : { ok: false, why: `GitHub trả ${r.status}: ${(await r.text()).slice(0, 200)}` };
  } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 200) }; }
}

const blank = () => ({ fails: 0, down: false, alerted: false, since: 0, why: "" });

/**
 * Một lượt kiểm (mỗi phút). Lỗi một lần thì chờ retryMs rồi gọi lại (deploy xanh / lam, mạng chập chờn không tính là lỗi).
 * Lỗi đủ FAILS_TO_ALERT phút liền → báo "down" một lần; trở lại bình thường sau khi đã báo → báo "up". Gửi báo lỗi thì phút sau thử lại.
 * @returns {Promise<{ ok: boolean, why: string, state: object, sent?: string, wrote: boolean }>}
 */
export async function check(env, deps = {}) {
  const f = deps.fetch ?? fetch, sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now = deps.now ?? Date.now;
  const url = env.HEALTH_URL || DEFAULT_URL, need = Math.max(1, Number(env.FAILS_TO_ALERT) || 3), retryMs = deps.retryMs ?? 15_000;
  let res = await probe(f, url);
  if (!res.ok) { await sleep(retryMs); res = await probe(f, url); }
  const raw = env.UPTIME ? await env.UPTIME.get("state") : null;
  let prev = blank();
  try { if (raw) prev = { ...prev, ...JSON.parse(raw) }; } catch { /* trạng thái hỏng: bắt đầu lại */ }
  const next = { ...prev };
  let sent;
  if (res.ok) {
    if (prev.alerted) {
      const d = await dispatch(env, f, "up", `${res.why}; lỗi từ ${new Date(prev.since).toISOString()}`);
      if (d.ok) sent = "up";
      // Báo "đã hồi" không gửi được thì vẫn về trạng thái tốt: lần lỗi sau báo lại bình thường.
    }
    Object.assign(next, blank());
  } else {
    next.fails = Math.min(prev.fails + 1, need);
    next.why = res.why.slice(0, 300);
    if (!prev.fails) next.since = now();
    if (next.fails >= need) {
      next.down = true;
      if (!prev.alerted) {
        const d = await dispatch(env, f, "down", `${res.why} (${need} phút liền)`);
        next.alerted = d.ok;
        if (d.ok) sent = "down"; else next.why = `${next.why}; chưa báo được: ${d.why}`.slice(0, 300);
      }
    }
  }
  // Chỉ ghi khi đổi (giữ dưới hạn mức ghi của KV Free). "why" đổi theo từng phút lỗi nên không tính vào phép so sánh.
  const key = (s) => JSON.stringify([s.fails, s.down, s.alerted, s.since]);
  const wrote = !!env.UPTIME && key(next) !== key(prev);
  if (wrote) await env.UPTIME.put("state", JSON.stringify(next));
  return { ok: res.ok, why: res.why, state: next, sent, wrote };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env).then((r) => console.log(JSON.stringify({ ok: r.ok, why: r.why, fails: r.state.fails, sent: r.sent ?? null }))));
  },
  // Xem trạng thái đang lưu (không gọi /api/health, không kích GitHub). wrangler.toml tắt workers_dev nên chỉ mở được khi chủ sở hữu tự bật.
  async fetch(_req, env) {
    const raw = env.UPTIME ? await env.UPTIME.get("state") : null;
    return new Response(raw ?? JSON.stringify(blank()), { headers: { "content-type": "application/json; charset=utf-8" } });
  },
};
