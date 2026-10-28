// Kết nối tiện ích ↔ máy chủ Synchro. Dùng chung cho tiện ích thật (background.js) và tiện ích giả lập (scripts/mock-extension.mjs).
// - Ghép nối: POST /api/browser/ext/pair { code, name, browser } → khóa riêng của trình duyệt này (lưu trong máy, máy chủ chỉ giữ bản băm).
// - Kết nối: POST /api/browser/ext/connect (Authorization: Bearer khóa) → vé WebSocket một phút → WebSocket tới /ws-agent/ext.
// - Lệnh: { t: "call", id, a, turn } → control.call() → { t: "res", id, r } hoặc { t: "res", id, error, status }; { t: "stop" }; { t: "release" }.
// - Giữ kết nối: { t: "ka" } mỗi 20 giây (service worker của tiện ích không bị Chrome tắt khi WebSocket còn trao đổi); mất kết nối thì
//   thử lại sau 1, 2, 5, 10, rồi mỗi 30 giây. Trình duyệt bị gỡ khỏi Synchro (401 / đóng mã 4001): xóa khóa, quay về màn hình ghép nối.
export const normServer = (s) => {
  let v = String(s ?? "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = (/^(localhost|127\.|\[::1\])/.test(v) ? "http://" : "https://") + v;
  try { const u = new URL(v); return u.origin; } catch { return ""; }
};

export function createLink({ fetch: f = globalThis.fetch.bind(globalThis), WebSocket: WS = globalThis.WebSocket, store, control, device, onState = () => {}, revoked = "" }) {
  let ws = null, state = "unpaired", error = "", timer = 0, ka = 0, tries = 0, busy = false;
  const snap = () => ({ state, error });
  const set = (s, e) => { state = s; if (e !== undefined) error = e; onState(snap()); };
  const send = (o) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} };

  async function api(server, path, body, token) {
    const r = await f(server + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Synchro trả lỗi ${r.status}`), { status: r.status });
    return j;
  }

  async function pair(server, code) {
    const s = normServer(server);
    if (!s) throw new Error("server");
    const j = await api(s, "/api/browser/ext/pair", { code, ...device() });
    await store.set({ server: s, token: j.token, device: j.device, user: j.user });
    tries = 0;
    close();
    connect();
    return j;
  }
  async function forget(msg = "") {
    await store.remove(["token", "device", "user"]);
    close();
    set("unpaired", msg);
  }
  function close() { clearTimeout(timer); clearInterval(ka); const s = ws; ws = null; try { s?.close(1000, "bye"); } catch {} }
  function retry(msg) {
    set("offline", msg ?? "");
    clearTimeout(timer);
    timer = setTimeout(connect, [1, 2, 5, 10, 30][Math.min(tries++, 4)] * 1000);
  }

  async function connect() {
    if (busy || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
    busy = true;
    clearTimeout(timer);
    try {
      const cfg = await store.get();
      if (!cfg.token || !cfg.server) return set("unpaired");
      set("connecting");
      let j;
      try { j = await api(cfg.server, "/api/browser/ext/connect", device(), cfg.token); }
      catch (e) { if (e.status === 401) return forget(revoked || e.message); return retry(e.message); }
      if (j.user) await store.set({ user: j.user });
      const s = new WS(j.url);
      ws = s;
      s.onopen = () => {
        tries = 0;
        set("online", "");
        send({ t: "hello", ...device(), scope: control.scope() });
        control.report().catch(() => {});
        clearInterval(ka);
        ka = setInterval(() => send({ t: "ka" }), 20_000);
      };
      s.onmessage = (e) => { onMessage(typeof e.data === "string" ? e.data : String(e.data)); };
      s.onclose = (e) => {
        if (ws !== s) return;
        ws = null; clearInterval(ka);
        if (e.code === 4001) { forget(revoked); return; }
        // Cùng trình duyệt vừa nối lại bằng kết nối mới: kết nối cũ này thôi.
        if (e.code === 4000) return;
        retry();
      };
      s.onerror = () => {};
    } catch (e) { retry(e?.message); }
    finally { busy = false; }
  }

  async function onMessage(raw) {
    let j; try { j = JSON.parse(raw); } catch { return; }
    if (j.t === "call") {
      try { send({ t: "res", id: j.id, r: await control.call(j.a ?? {}, j.turn ?? "") }); }
      catch (e) { send({ t: "res", id: j.id, error: e?.message || String(e), status: e?.status ?? 500 }); }
    } else if (j.t === "stop") control.stop("synchro");
    else if (j.t === "release") control.release();
  }

  return { pair, connect, forget, send, close, state: snap, online: () => state === "online" };
}
