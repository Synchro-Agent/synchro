// Cầu nối tới tiện ích Synchro trong Chrome / Edge / Brave của người dùng. Dùng chung cho dịch vụ workspace trên VPS
// (workspace/agent.mjs) và workspace giả lập khi chạy dev:mock (scripts/mock-workspace.mjs).
// - Tiện ích mở WebSocket /ws-agent/ext bằng vé ký HMAC mà máy chủ Next cấp cho thiết bị đã ghép nối (k = "ext", d = id thiết bị).
// - Máy chủ Next gửi lệnh qua HTTP POST /ext { u, op, … }: call (một thao tác browser_*, chờ kết quả cùng dạng với workspace/browser-core.mjs),
//   status (thiết bị nào đang kết nối, tab đang làm), stop (người dùng bấm Dừng ở Synchro), release (hết lượt: bỏ dải điều khiển), kick (gỡ thiết bị).
// Giao thức trên WebSocket (JSON):
//   máy chủ → tiện ích: { t: "call", id, a, turn } · { t: "stop" } · { t: "release" } · { t: "bye", reason }
//   tiện ích → máy chủ: { t: "hello", name, browser, version, ext, scope } · { t: "status", … } · { t: "res", id, r } hoặc { t: "res", id, error, status }
//                       { t: "act", kind, label } (đang làm gì) · { t: "stopped" } (người dùng bấm Dừng trong Chrome) · { t: "ka" } (giữ kết nối)
// Tiện ích mất kết nối giữa chừng (Chrome tắt service worker của tiện ích, mạng chập chờn): thao tác đang chờ báo lỗi rõ để model kiểm tra
// lại trang; thao tác mới trong lúc đó đợi tiện ích nối lại (tối đa RECONNECT_MS) thay vì báo "chưa kết nối".
import { BrowserError } from "./browser-act.mjs";

export const STOPPED = 499;
// Báo thức của tiện ích đánh thức service worker mỗi 30 giây: chờ lâu hơn một chút.
const RECONNECT_MS = 40_000, RECENT_MS = 3 * 60_000;

export function createRelay({ log = () => {} } = {}) {
  const users = new Map(); // u -> Map<d, conn>
  const gone = new Map(), waiting = new Map(); // u -> lúc mất kết nối gần nhất · u -> Set<hàm báo đã nối lại>
  let seq = 0;
  const conns = (u) => [...(users.get(u)?.values() ?? [])];
  // Thiết bị nhận lệnh: thiết bị kết nối gần nhất (người dùng vừa mở trình duyệt đó).
  const pick = (u) => conns(u).sort((a, b) => b.at - a.at)[0] ?? null;
  const send = (c, o) => { try { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); } catch {} };

  function attach(ws, u, d) {
    if (!users.has(u)) users.set(u, new Map());
    const map = users.get(u);
    const old = map.get(d);
    if (old) { send(old, { t: "bye", reason: "replaced" }); old.ws.close(4000, "replaced"); }
    const c = { ws, u, d, at: Date.now(), seen: Date.now(), hello: {}, status: {}, last: null, pending: new Map() };
    map.set(d, c);
    for (const f of waiting.get(u) ?? []) f();
    waiting.delete(u);
    ws.on("message", (m) => {
      c.seen = Date.now();
      let j; try { j = JSON.parse(m.toString()); } catch { return; }
      if (j.t === "hello") { c.hello = { name: String(j.name ?? "").slice(0, 80), browser: String(j.browser ?? "").slice(0, 40), version: String(j.version ?? "").slice(0, 40), ext: String(j.ext ?? "").slice(0, 20) }; c.status = { ...c.status, scope: j.scope === "group" ? "group" : "all" }; }
      else if (j.t === "status") c.status = { ...c.status, ...pickStatus(j) };
      else if (j.t === "act") c.last = { kind: String(j.kind ?? "").slice(0, 20), label: String(j.label ?? "").slice(0, 200), at: Date.now() };
      else if (j.t === "stopped") { c.stoppedAt = Date.now(); for (const p of c.pending.values()) p.no(new BrowserError(STOPPED, "Người dùng đã bấm Dừng trong Chrome.")); c.pending.clear(); }
      else if (j.t === "res" && c.pending.has(j.id)) {
        const p = c.pending.get(j.id); c.pending.delete(j.id);
        if (j.error) p.no(new BrowserError(Number(j.status) || 400, String(j.error).slice(0, 4000))); else p.ok(j.r ?? {});
      }
    });
    ws.on("close", () => {
      if (map.get(d) === c) { map.delete(d); gone.set(u, Date.now()); }
      if (!map.size && users.get(u) === map) users.delete(u);
      for (const p of c.pending.values()) p.no(new BrowserError(503, "Tiện ích Synchro trong Chrome vừa mất kết nối giữa chừng (Chrome tạm tắt tiện ích hoặc mạng chập chờn), thao tác này có thể đã xong hoặc chưa. Synchro tự nối lại: đọc lại trang (browser_read hoặc browser_screenshot) rồi làm tiếp từ chỗ đang dở."));
      c.pending.clear();
    });
    ws.on("error", () => {});
    log(`tiện ích Chrome của ${u} đã kết nối (${d})`);
  }
  const pickStatus = (j) => {
    const o = {};
    if (j.scope) o.scope = j.scope === "group" ? "group" : "all";
    if (j.tab !== undefined) o.tab = j.tab && typeof j.tab === "object" ? { title: String(j.tab.title ?? "").slice(0, 200), url: String(j.tab.url ?? "").slice(0, 500) } : null;
    if (j.tabs !== undefined) o.tabs = Math.max(0, Number(j.tabs) || 0);
    if (j.acting !== undefined) o.acting = !!j.acting;
    if (j.paused !== undefined) o.paused = !!j.paused;
    return o;
  };

  // Một thao tác browser_* trên trình duyệt của người dùng. Kết quả cùng dạng với browser-core.tool().
  // Chờ tiện ích vừa mất kết nối nối lại (service worker được Chrome đánh thức, kết nối lại sau vài giây).
  const reconnect = (u, ms) => new Promise((ok) => {
    if (pick(u)) return ok(true);
    if (Date.now() - (gone.get(u) ?? 0) > RECENT_MS) return ok(false);
    const set = waiting.get(u) ?? new Set();
    waiting.set(u, set);
    const done = (v) => { clearTimeout(t); set.delete(f); ok(v); };
    const f = () => done(true);
    const t = setTimeout(() => done(false), ms);
    set.add(f);
  });
  async function call(u, a, { turn = "", timeout = 90_000 } = {}) {
    let c = pick(u);
    if (!c && (await reconnect(u, Math.min(RECONNECT_MS, timeout)))) c = pick(u);
    if (!c) throw new BrowserError(409, "Chrome của người dùng chưa kết nối với Synchro.");
    const id = ++seq;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { c.pending.delete(id); no(new BrowserError(504, "Chrome của người dùng phản hồi quá lâu.")); }, timeout);
      c.pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, no: (e) => { clearTimeout(t); no(e); } });
      send(c, { t: "call", id, a, turn: String(turn).slice(0, 80) });
    });
  }
  const info = (u) => {
    const cur = pick(u);
    return { connected: !!cur, device: cur?.d ?? null, devices: conns(u).map((c) => ({ id: c.d, ...c.hello, ...c.status, since: c.at, seen: c.seen, last: c.last, active: c === cur })) };
  };
  const notify = (u, o) => { for (const c of conns(u)) send(c, o); };
  // Gỡ thiết bị: đóng kết nối của thiết bị đó (vé cũ hết hạn sau một phút, tiện ích không lấy được vé mới).
  const kick = (u, d) => { const c = users.get(u)?.get(d); if (c) { send(c, { t: "bye", reason: "revoked" }); c.ws.close(4001, "revoked"); } };

  // Máy chủ Next gọi (đã kiểm tra khóa Bearer).
  async function http(b) {
    const u = String(b.u);
    switch (b.op) {
      case "call": return call(u, b.a && typeof b.a === "object" ? b.a : {}, { turn: b.turn, timeout: Math.min(Number(b.timeout) || 90_000, 300_000) });
      case "status": return info(u);
      case "stop": notify(u, { t: "stop" }); return { ok: true };
      case "release": notify(u, { t: "release" }); return { ok: true };
      case "kick": kick(u, String(b.d ?? "")); return { ok: true };
      default: throw new BrowserError(400, "Thao tác không hợp lệ.");
    }
  }
  return { attach, call, info, notify, kick, http };
}
