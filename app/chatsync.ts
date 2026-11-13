"use client";
// Đoạn chat và dự án đi theo tài khoản. localStorage vẫn là bản làm việc của thiết bị (mở app không phải chờ mạng, mất mạng vẫn đọc được); máy chủ giữ bản theo tài khoản.
// - Chuyển dần: lần đầu mở bản mới, mọi đoạn chat chỉ có ở trình duyệt được đẩy lên; bản ở trình duyệt không bị xóa, kể cả khi máy chủ đã nhận.
// - Xung đột: theo từng mục, mốc sửa mới nhất thắng. Bản thua mà có tin người dùng bên kia chưa có thì giữ thành một đoạn chat riêng, không mất tin.
// - Xóa luôn là lệnh rõ ràng (forget), không bao giờ suy ra từ việc danh sách ngắn đi: đăng xuất, đổi tài khoản hay lỗi đọc dữ liệu không thể làm mất gì trên máy chủ.
// - Trình duyệt hết chỗ: rút gọn các đoạn chat cũ đã có trên máy chủ (nội dung tải lại khi mở trang). Chưa kịp lên máy chủ thì báo ngay kèm nút xuất dữ liệu.
// - Đoạn chat ẩn danh không bao giờ rời trình duyệt.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { batches, earlyUsable, hashOf, keyOf, lastTime, losesUserMsgs, parseMeta, saveFit, serialChat, serialProject, startupDirty, decideRemote, stubOf, TIMED_OUT, withDeadline, type Part, type SyncKind, type SyncMeta } from "./chatsynccore";
import { tr } from "./i18n";
import type { Chat, Project } from "./store";
import { ls, scopedFor, userScope } from "./userscope";

const PUSH_WAIT = 1500, POLL = 30_000, RUN_EVERY = 30_000, BATCH = 1_500_000, MAX_WAIT = 300_000;
const URL_ = "/api/chats";
type Remote = { kind: SyncKind; id: string; upd: number; rev: number; deleted: number; data: string | null };
type Result = { kind: SyncKind; id: string; ok: boolean; upd: number; deleted?: boolean; error?: string };

// Bản lưu của từng mục: nhớ theo đối tượng (mỗi khung hình chữ đang chảy chỉ đoạn chat đang viết phải làm lại).
const cacheS = new WeakMap<object, { s: string; h: string }>();
const serial = (kind: SyncKind, x: Chat | Project) => {
  let v = cacheS.get(x);
  if (!v) { const s = kind === "chat" ? serialChat(x as Chat) : serialProject(x as Project); v = { s, h: hashOf(s) }; cacheS.set(x, v); }
  return v;
};

const cacheStub = new WeakMap<object, string>();
const stubStr = (kind: SyncKind, x: Chat | Project) => {
  let v = cacheStub.get(x);
  if (v === undefined) { v = JSON.stringify(kind === "chat" ? stubOf(x as Chat) : { ...x, ctx: [], stub: true }); cacheStub.set(x, v); }
  return v;
};

// Trạng thái để hiện cho người dùng (dải cảnh báo, Cài đặt).
export type SyncStatus = { pending: number; tooBig: number; localFull: boolean; offline: boolean; risk: boolean; at: number };
let status: SyncStatus = { pending: 0, tooBig: 0, localFull: false, offline: false, risk: false, at: 0 };
const subs = new Set<() => void>();
const setStatus = (p: Partial<SyncStatus>) => {
  const n = { ...status, ...p };
  // Có nguy cơ mất dữ liệu: trình duyệt không ghi được VÀ máy chủ chưa có bản mới nhất.
  n.risk = n.localFull && (n.pending > 0 || n.tooBig > 0);
  if (JSON.stringify(n) !== JSON.stringify(status)) { status = n; subs.forEach((f) => f()); }
};
export const useSyncStatus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => status, () => status);

// Lần hỏi đầu bắt đầu sớm (blueprint A3.4): trang chủ dựng sẵn ở máy chủ đã biết tài khoản, nên hỏi /api/chats?since= ngay lúc hydrate,
// không chờ trang dựng xong và lượt đồng bộ khởi động. Lượt đồng bộ đầu dùng kết quả này nếu đúng tài khoản và đúng mốc (earlyUsable), không thì bỏ.
let early: { uid: string; since: number; p: Promise<Response | null> } | null = null;
export function prefetchChats(uid: string) {
  if (early || !uid || typeof window === "undefined") return;
  let since = 0;
  try { since = parseMeta(localStorage.getItem(scopedFor(uid, "chatSync"))).cur; } catch {}
  early = { uid, since, p: fetch(`${URL_}?since=${since}`, { cache: "no-store" }).catch(() => null) };
}
const takeEarly = (scope: string, since: number) => { const e = early; early = null; return e && earlyUsable(e, scope, since) ? e.p : null; };

// Đoạn chat lấy từ máy chủ đã được thiết bị khác đưa vào bộ não, không cần nạp lại từ thiết bị này (useBrainSync).
function brainSeen(ids: string[]) {
  if (!ids.length) return;
  try { const k = "bn:synced"; localStorage.setItem(k, JSON.stringify([...new Set([...(JSON.parse(localStorage.getItem(k) ?? "[]") as string[]), ...ids])].slice(-5000))); } catch {}
}

type Sess = {
  on: boolean; scope: string; meta: SyncMeta; prev: { chat: Map<number, object>; project: Map<number, object> }; fromServer: WeakSet<object>;
  timer: ReturnType<typeof setTimeout> | null; busy: boolean; fails: number; tooBig: Map<string, string>; lastPush: Map<string, number>; pulling: boolean;
};

export type ChatSync = {
  saveChats: (l: Chat[]) => void; saveProjects: (l: Project[]) => void; forget: (kind: SyncKind, ids: number[]) => void; wipeAll: (chats: number[], projects: number[]) => void;
  /** Đẩy ngay mọi mục chưa lên máy chủ (kể cả đoạn chat đang chạy) và chờ, tối đa ms. Trả về số mục vẫn chỉ có ở thiết bị này. */
  flush: (ms?: number) => Promise<number>;
};

export function useChatSync(o: { uid: string | null; loaded: boolean; chats: Chat[]; projects: Project[]; running: ReadonlySet<number>; setChats: React.Dispatch<React.SetStateAction<Chat[]>>; setProjects: React.Dispatch<React.SetStateAction<Project[]>> }): ChatSync {
  const live = useRef(o);
  live.current = o;
  const sess = useRef<Sess | null>(null);
  const fit = useRef({ chat: new Set<string>(), project: new Set<string>() });
  const full = useRef({ chat: false, project: false });

  const ok = (s: Sess) => s.on && s.scope === userScope() && sess.current === s;
  const saveMeta = (s: Sess) => { if (s.scope === userScope()) ls.set("chatSync", JSON.stringify(s.meta)); };
  const report = (s: Sess) => setStatus({ pending: Math.max(0, Object.keys(s.meta.dirty).length + Object.keys(s.meta.gone).length - s.tooBig.size), tooBig: s.tooBig.size, localFull: full.current.chat || full.current.project });
  const later = (s: Sess, ms = PUSH_WAIT) => { if (s.timer) clearTimeout(s.timer); s.timer = setTimeout(() => { s.timer = null; void push(s); }, ms); };

  // ---- Nhận từ máy chủ ----
  const apply = (s: Sess, items: Remote[]) => {
    if (!items.length) return;
    const cur = { chat: new Map(live.current.chats.map((c) => [String(c.id), c])), project: new Map(live.current.projects.map((p) => [String(p.id), p])) };
    const up = { chat: new Map<string, Chat>(), project: new Map<string, Project>() }, del = { chat: new Set<string>(), project: new Set<string>() };
    const copies: Chat[] = [], fresh: string[] = [];
    for (const it of items) {
      if (it.kind !== "chat" && it.kind !== "project") continue;
      const key = keyOf(it.kind, it.id), mine = cur[it.kind].get(it.id) as (Chat | Project) | undefined;
      // Vừa xóa ở máy này: lệnh xóa đang trên đường đi, bản cũ về không được làm nó sống lại.
      if (s.meta.gone[key]) continue;
      const stubbed = !!mine?.stub;
      // Câu trả lời cũ của lần lấy trước về sau khi máy này đã đẩy bản mới hơn.
      if (!stubbed && (s.meta.known[key]?.[0] ?? 0) > it.upd) continue;
      if (!stubbed && decideRemote(s.meta, key, it.upd, it.kind === "chat" && live.current.running.has(Number(it.id))) === "keep") continue;
      if (it.deleted || it.data === null) {
        delete s.meta.known[key]; delete s.meta.dirty[key];
        if (mine) del[it.kind].add(it.id);
        continue;
      }
      const h = hashOf(it.data);
      // Bản của chính thiết bị này vừa đẩy lên quay về.
      if (mine && !stubbed && serial(it.kind, mine).h === h) { s.meta.known[key] = [it.upd, h]; delete s.meta.dirty[key]; continue; }
      let obj: Chat | Project;
      try { obj = JSON.parse(it.data); } catch { continue; }
      if (!obj || typeof obj !== "object" || Number(obj.id) !== Number(it.id)) continue;
      cacheS.set(obj, { s: it.data, h });
      s.fromServer.add(obj);
      if (it.kind === "chat") {
        if (s.meta.dirty[key] && mine && losesUserMsgs(mine as Chat, obj as Chat)) copies.push({ ...(mine as Chat), id: Date.now() + copies.length, title: `${(mine as Chat).title} ${tr("(bản trên thiết bị này)")}` });
        up.chat.set(it.id, obj as Chat);
        if (!mine) fresh.push(it.id);
      } else up.project.set(it.id, obj as Project);
      s.meta.known[key] = [it.upd, h];
      delete s.meta.dirty[key];
    }
    const merge = <T extends { id: number }>(l: T[], u: Map<string, T>, d: Set<string>, extra: T[] = []) => {
      const had = new Set(l.map((x) => String(x.id)));
      const out = [...extra, ...l.filter((x) => !d.has(String(x.id))).map((x) => u.get(String(x.id)) ?? x), ...[...u].filter(([k]) => !had.has(k)).map(([, v]) => v)];
      // Thanh bên xếp đoạn mới nhất lên đầu; mục mới về được chèn đúng chỗ.
      return extra.length || out.length !== l.length ? out.sort((a, b) => b.id - a.id) : out;
    };
    if (up.chat.size || del.chat.size || copies.length) live.current.setChats((l) => merge(l, up.chat, del.chat, copies));
    if (up.project.size || del.project.size) live.current.setProjects((l) => merge(l, up.project, del.project));
    brainSeen(fresh);
  };
  const pull = async (s: Sess) => {
    if (s.pulling) return;
    s.pulling = true;
    try {
      for (let i = 0; i < 500 && ok(s); i++) {
        const pre = i === 0 ? await takeEarly(s.scope, s.meta.cur) : null;
        const r = pre ?? await fetch(`${URL_}?since=${s.meta.cur}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json() as { items: Remote[]; next: number; more: boolean };
        if (!ok(s)) return;
        apply(s, j.items);
        s.meta.cur = j.next;
        saveMeta(s);
        setStatus({ offline: false, at: Date.now() });
        if (!j.more) break;
      }
    } catch { if (ok(s)) setStatus({ offline: true }); } finally { s.pulling = false; report(s); }
  };
  const fetchKeys = async (s: Sess, keys: string[]) => {
    for (let i = 0; i < keys.length && ok(s); i += 100) {
      const r = await fetch(`${URL_}?keys=${encodeURIComponent(keys.slice(i, i + 100).join(","))}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const j = await r.json().catch(() => null) as { items?: Remote[] } | null;
      if (j?.items && ok(s)) apply(s, j.items);
    }
  };

  // ---- Đẩy lên máy chủ ----
  const send = async (b: Part[] | { wipe: number }) => {
    const r = await fetch(URL_, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(Array.isArray(b) ? { items: b.map((p) => ({ kind: p.kind, id: p.id, upd: p.upd, data: p.data, deleted: p.deleted })) } : b) });
    return r;
  };
  const push = async (s: Sess) => {
    if (!ok(s) || s.busy) return;
    s.busy = true;
    let again = false, wait = PUSH_WAIT;
    try {
      const now = Date.now(), parts: Part[] = [];
      const m = s.meta;
      for (const [key, upd] of Object.entries(m.gone)) { const i = key.indexOf(":"); parts.push({ key, kind: key.slice(0, i) as SyncKind, id: key.slice(i + 1), upd, deleted: true, size: 80 }); }
      const items = { chat: new Map(live.current.chats.map((c) => [String(c.id), c as Chat | Project])), project: new Map(live.current.projects.map((p) => [String(p.id), p as Chat | Project])) };
      for (const [key, upd] of Object.entries(m.dirty)) {
        const i = key.indexOf(":"), kind = key.slice(0, i) as SyncKind, id = key.slice(i + 1), x = items[kind]?.get(id);
        if (!x || (x as Chat).inc) { delete m.dirty[key]; continue; }
        if (x.stub) continue;
        const v = serial(kind, x);
        if (m.known[key]?.[1] === v.h) { delete m.dirty[key]; s.tooBig.delete(key); continue; }
        if (s.tooBig.get(key) === v.h) continue;
        // Câu trả lời đang chảy: đẩy thưa, để máy khác thấy tiến độ mà không gửi lại cả đoạn chat mỗi khung hình.
        if (kind === "chat" && live.current.running.has(Number(id)) && now - (s.lastPush.get(key) ?? 0) < RUN_EVERY) { again = true; wait = RUN_EVERY; continue; }
        s.tooBig.delete(key);
        parts.push({ key, kind, id, upd, data: v.s, size: v.s.length });
      }
      const conflicts: string[] = [];
      const queue = batches(parts, BATCH);
      for (let bi = 0; bi < queue.length && ok(s); bi++) {
        const b = queue[bi];
        const r = await send(b);
        // Proxy phía trước từ chối thân yêu cầu lớn (trang lỗi HTML): tách ra gửi riêng, một mục vẫn lớn quá thì giữ lại ở trình duyệt và báo.
        if (r.status === 413) {
          if (b.length > 1) { queue.splice(bi + 1, 0, ...b.map((p) => [p])); continue; }
          if (b[0].data) s.tooBig.set(b[0].key, hashOf(b[0].data));
          continue;
        }
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json() as { results: Result[] };
        if (!ok(s)) return;
        j.results.forEach((res, k) => {
          const p = b[k];
          if (!p) return;
          if (res.ok) {
            if (p.deleted) delete m.gone[p.key];
            else {
              m.known[p.key] = [res.upd, hashOf(p.data!)];
              s.lastPush.set(p.key, Date.now());
              // Trong lúc gửi có sửa mới thì mục vẫn chờ đợt sau.
              if (m.dirty[p.key] === p.upd) delete m.dirty[p.key];
            }
          } else if (res.error === "disk") { again = true; wait = MAX_WAIT; } // Máy chủ tạm thời hết chỗ: giữ nguyên để gửi lại, không coi là quá lớn.
          else if (res.error) { if (p.data) s.tooBig.set(p.key, hashOf(p.data)); else delete m.gone[p.key]; }
          else {
            // Máy chủ có bản mới hơn: lấy về (mới nhất thắng). Đã bị xóa ở nơi khác thì xóa luôn ở đây.
            delete m.gone[p.key];
            s.lastPush.set(p.key, Date.now());
            if (m.dirty[p.key] === p.upd) m.dirty[p.key] = Math.min(res.upd, p.upd);
            if (res.deleted) apply(s, [{ kind: p.kind, id: p.id, upd: res.upd, rev: 0, deleted: 1, data: null }]);
            else conflicts.push(p.key);
          }
        });
        saveMeta(s);
      }
      if (m.wipe && ok(s)) {
        const r = await send({ wipe: m.wipe });
        if (!r.ok) throw new Error(String(r.status));
        delete m.wipe;
      }
      if (conflicts.length && ok(s)) {
        // Bản ở đây thua: apply nhận bản máy chủ, giữ bản sao nếu cần, và bỏ dấu "chưa đẩy". Còn dấu (đang chạy, lấy không được) thì thử lại thưa, không gửi lại liên tục.
        await fetchKeys(s, conflicts);
        if (conflicts.some((k) => m.dirty[k])) { again = true; wait = RUN_EVERY; }
      }
      s.fails = 0;
      setStatus({ offline: false, at: Date.now() });
    } catch {
      s.fails++;
      again = true;
      wait = Math.min(MAX_WAIT, 5000 * 2 ** Math.min(s.fails, 6));
      if (ok(s)) setStatus({ offline: true });
    } finally {
      s.busy = false;
      saveMeta(s);
      report(s);
      if (ok(s) && (again || Object.keys(s.meta.gone).length || Object.keys(s.meta.dirty).some((k) => !s.tooBig.has(k) && !isStub(k)))) later(s, again ? wait : PUSH_WAIT);
    }
  };
  const isStub = (key: string) => { const id = Number(key.slice(key.indexOf(":") + 1)); const l: (Chat | Project)[] = key.startsWith("chat:") ? live.current.chats : live.current.projects; return !!l.find((c) => c.id === id)?.stub; };

  // ---- Bắt đầu theo tài khoản ----
  useEffect(() => {
    const uid = o.uid;
    if (!o.loaded || !uid || userScope() !== uid) return;
    const meta = parseMeta(ls.get("chatSync"));
    fit.current = { chat: new Set(), project: new Set() }; full.current = { chat: false, project: false };
    const s: Sess = { on: true, scope: uid, meta, prev: { chat: new Map(), project: new Map() }, fromServer: new WeakSet(), timer: null, busy: false, fails: 0, tooBig: new Map(), lastPush: new Map(), pulling: false };
    sess.current = s;
    const need: string[] = [], here = new Set<string>();
    const scan = (kind: SyncKind, l: (Chat | Project)[]) => {
      for (const x of l) {
        s.prev[kind].set(x.id, x);
        if ((x as Chat).inc) continue;
        const key = keyOf(kind, x.id);
        here.add(key);
        if (x.stub) { need.push(key); continue; }
        const d = startupDirty(meta, key, serial(kind, x).h, kind === "chat" ? lastTime(x as Chat) : ((x as Project).upd ?? x.id));
        if (d === null) delete meta.dirty[key]; else meta.dirty[key] = d;
      }
    };
    scan("chat", o.chats); scan("project", o.projects);
    // Máy chủ đã có mà bản ở đây không còn (lần ghi trước của trình duyệt thất bại vì hết chỗ): lấy lại.
    for (const key of Object.keys(meta.known)) if (!here.has(key) && !meta.gone[key]) need.push(key);
    const tick = () => { if (!document.hidden && navigator.onLine !== false && ok(s)) void pull(s).then(() => { if (ok(s) && !s.timer) later(s, 0); }); };
    void pull(s).then(() => fetchKeys(s, need)).then(() => { if (ok(s)) later(s, 0); });
    const t = setInterval(tick, POLL);
    const vis = () => { if (!document.hidden) tick(); };
    window.addEventListener("focus", tick); window.addEventListener("online", tick); document.addEventListener("visibilitychange", vis);
    return () => {
      s.on = false; clearInterval(t); if (s.timer) clearTimeout(s.timer);
      window.removeEventListener("focus", tick); window.removeEventListener("online", tick); document.removeEventListener("visibilitychange", vis);
      saveMeta(s);
      if (sess.current === s) sess.current = null;
      setStatus({ pending: 0, tooBig: 0, localFull: false, offline: false });
    };
  }, [o.loaded, o.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mục nào đổi (đối tượng khác) mà không phải vừa từ máy chủ về thì chờ đẩy lên. Mục biến mất không suy ra là xóa.
  useEffect(() => {
    const s = sess.current;
    if (!s || !ok(s)) return;
    let any = false;
    const now = Date.now();
    const scan = (kind: SyncKind, l: (Chat | Project)[]) => {
      const next = new Map<number, object>();
      for (const x of l) {
        next.set(x.id, x);
        if (s.prev[kind].get(x.id) === x || s.fromServer.has(x) || (x as Chat).inc || x.stub) continue;
        const key = keyOf(kind, x.id);
        if (s.meta.gone[key]) continue;
        s.meta.dirty[key] = now;
        any = true;
      }
      s.prev[kind] = next;
    };
    scan("chat", o.chats); scan("project", o.projects);
    // Không đặt lại đồng hồ đang chạy: chữ đang chảy mỗi khung hình không được làm trễ mãi việc đẩy.
    if (any && !s.timer) later(s);
  }, [o.chats, o.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Câu trả lời vừa xong: đẩy bản cuối ngay, không chờ hết nhịp đẩy thưa của lúc đang chạy.
  useEffect(() => { const s = sess.current; if (s && ok(s) && Object.keys(s.meta.dirty).length) later(s); }, [o.running]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- API cho trang ----
  const api = useRef<ChatSync | null>(null);
  if (!api.current) {
    const save = (kind: SyncKind, name: string, l: (Chat | Project)[]) => {
      const s = sess.current;
      const rows = l.filter((x) => !(x as Chat).inc).map((x) => {
        const v = serial(kind, x), key = keyOf(kind, x.id);
        const onServer = !!s && s.meta.known[key]?.[1] === v.h && !s.meta.dirty[key] && !x.stub;
        return { key, full: v.s, time: kind === "chat" ? lastTime(x as Chat) : ((x as Project).upd ?? x.id), stub: onServer ? stubStr(kind, x) : null };
      });
      const r = saveFit(rows, fit.current[kind], (json) => ls.set(name, json));
      fit.current[kind] = r.stubbed;
      full.current[kind] = !r.ok;
      if (s) report(s); else setStatus({ localFull: full.current.chat || full.current.project });
    };
    api.current = {
      saveChats: (l) => save("chat", "chats", l),
      saveProjects: (l) => save("project", "projects", l),
      forget: (kind, ids) => {
        const s = sess.current;
        if (!s) return;
        for (const id of ids) { const key = keyOf(kind, id); s.meta.gone[key] = Date.now(); delete s.meta.dirty[key]; delete s.meta.known[key]; s.tooBig.delete(key); }
        saveMeta(s);
        later(s, 0);
      },
      flush: async (ms = 15_000) => {
        const s = sess.current;
        if (!s || !ok(s)) return 0;
        const end = Date.now() + ms, sent = new Set<string>();
        // Mục còn chờ: chưa đẩy được, hoặc đã xóa mà lệnh xóa chưa tới. Đoạn chat đang chạy đã đẩy ít nhất một lần trong lượt này thì
        // tính là đã lên (phần còn lại do máy chủ chạy tiếp, đăng nhập lại thì trang nối vào lượt đó).
        const left = () => Object.keys(s.meta.gone).length + Object.keys(s.meta.dirty).filter((k) => !isStub(k) && !(sent.has(k) && live.current.running.has(Number(k.slice(k.indexOf(":") + 1))))).length;
        while (ok(s) && Date.now() < end) {
          if (s.busy) { await withDeadline(new Promise<void>((r) => setTimeout(r, 150)), end - Date.now()); continue; }
          if (s.timer) { clearTimeout(s.timer); s.timer = null; }
          // Bỏ nhịp đẩy thưa của đoạn chat đang chạy: lần này gửi bản mới nhất ngay.
          s.lastPush.clear();
          // push gồm nhiều lần fetch không có hạn giờ: một yêu cầu đứng sẽ treo cả flush. Chỉ chờ push trong hạn còn lại; hết giờ thì
          // thôi (push vẫn chạy nốt ở nền), left() còn mục chờ nên trả về khác 0 — nơi gọi sẽ không xóa phần chưa đồng bộ.
          const r = await withDeadline(push(s), end - Date.now());
          for (const k of s.lastPush.keys()) sent.add(k);
          if (r === TIMED_OUT) break;
          if (!left()) return 0;
          // Mất mạng, máy chủ lỗi, hoặc chỉ còn mục quá lớn (không bao giờ lên được): thôi chờ.
          if (s.fails || (Object.keys(s.meta.dirty).every((k) => s.tooBig.has(k) || isStub(k)) && !Object.keys(s.meta.gone).length)) break;
          await withDeadline(new Promise<void>((r) => setTimeout(r, 300)), end - Date.now());
        }
        return left();
      },
      wipeAll: (chats, projects) => {
        const s = sess.current;
        if (!s) return;
        const now = Date.now();
        s.meta.known = {}; s.meta.dirty = {}; s.tooBig.clear();
        for (const id of chats) s.meta.gone[keyOf("chat", id)] = now;
        for (const id of projects) s.meta.gone[keyOf("project", id)] = now;
        s.meta.wipe = now;
        saveMeta(s);
        later(s, 0);
      },
    };
  }
  return api.current;
}
