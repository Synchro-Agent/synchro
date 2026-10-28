"use client";
// Trình duyệt cạnh khung chat và trang Trình duyệt: chọn nơi Synchro làm việc khi bạn nhờ — trình duyệt của Synchro (BrowserPane, xem
// trực tiếp ngay đây) hoặc Chrome / Edge / Brave của bạn qua tiện ích Synchro (extension/): cài và ghép nối, trạng thái kết nối,
// Synchro đang làm gì trên Chrome của bạn, nút Dừng. Phần cài đặt + ghép nối (ExtSetup) dùng chung với Cài đặt → Khả năng.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { BrowserPane } from "./codepanes";
import { loadCaps, setCaps, useCaps } from "./capsclient";

type Say = (m: string) => void;
export type ExtDevice = { id: string; name: string; browser: string | null; createdAt: number; lastSeen: number | null; connected: boolean; active: boolean; scope: "all" | "group" | null; tab: { title: string; url: string } | null; acting: boolean; last: { kind: string; label: string; at: number } | null; version: string | null };
export type ExtState = { allowed: boolean; connected: boolean; devices: ExtDevice[]; target: "synchro" | "user"; mine: boolean };
type Where = "synchro" | "user";

const post = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/browser/ext", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Không kết nối được máy chủ.");
  return j;
};
const hostOf = (u: string) => { try { return new URL(u).host || u; } catch { return u; } };

/** Trình duyệt của bạn: các trình duyệt đã ghép nối, đang kết nối, Synchro đang làm gì (hỏi lại định kỳ khi live). */
export function useExt(live: boolean, every = 2500) {
  const [st, setSt] = useState<ExtState | null>(null);
  const reload = useCallback(async () => {
    const r = await fetch("/api/browser/ext", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setSt(await r.json());
  }, []);
  useEffect(() => {
    reload();
    if (!live) return;
    const i = setInterval(() => { if (!document.hidden) reload(); }, every);
    return () => clearInterval(i);
  }, [live, every, reload]);
  return { st, reload, setSt };
}

/** Cài tiện ích và ghép nối: tải .zip, cài bằng Developer mode, mã ghép nối một lần (chờ trình duyệt nối về). */
export function ExtSetup({ st, reload, say, pairOnly }: { st: ExtState | null; reload: () => void; say: Say; pairOnly?: boolean }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const before = useRef<string[]>([]);
  const fresh = code && st?.devices.find((d) => !before.current.includes(d.id));
  useEffect(() => {
    if (!code || fresh) return;
    const i = setInterval(() => { setNow(Date.now()); reload(); }, 1500);
    return () => clearInterval(i);
  }, [code, fresh, reload]);
  // Trình duyệt vừa ghép nối xong: nạp lại Cài đặt → Khả năng (trình duyệt đầu tiên thành nơi Synchro làm mặc định).
  useEffect(() => { if (fresh) loadCaps(true); }, [fresh?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = code ? Math.max(0, code.expiresAt - now) : 0;
  const getCode = async () => {
    setBusy(true);
    try { before.current = st?.devices.map((d) => d.id) ?? []; setCode(await post({ op: "code" })); setNow(Date.now()); }
    catch (e) { say((e as Error).message); }
    finally { setBusy(false); }
  };
  const copy = (t: string, m: string) => { navigator.clipboard?.writeText(t).then(() => say(m), () => {}); };
  const pairStep = (
    <div className="ext-step">
      <span className="ext-n">{pairOnly ? <I.Plug size={13} /> : "3"}</span>
      <div>
        <b>Ghép nối với tài khoản của bạn</b>
        {fresh ? <p className="ext-ok"><I.Check size={14} /><span>Đã kết nối <b data-notr>{fresh.name}</b><br />Từ giờ cứ nhờ Synchro trong khung chat, ví dụ “mở Gmail trên Chrome của tôi”.</span></p>
          : code && left > 0 ? <>
            <div className="ext-code"><code data-notr>{code.code}</code><button className="icon-btn" onClick={() => copy(code.code, "Đã sao chép mã")} aria-label="Sao chép mã" data-tip="Sao chép mã"><I.Copy size={15} /></button></div>
            <p>Bấm biểu tượng Synchro trên thanh công cụ của Chrome, nhập mã này rồi bấm Kết nối. Mã dùng một lần, hết hạn sau <span data-notr>{Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}</span>.</p>
            <p className="ext-wait"><span className="ag-spin" />Đang chờ trình duyệt kết nối…</p>
          </> : <>
            <p>Mỗi tài khoản Synchro ghép nối trình duyệt của mình bằng một mã riêng; trên máy khác cứ đăng nhập tài khoản của bạn rồi làm lại các bước này.</p>
            <button className="btn dark" disabled={busy || !st?.allowed} onClick={getCode}>{code ? "Lấy mã mới" : "Lấy mã ghép nối"}</button>
          </>}
      </div>
    </div>
  );
  if (pairOnly) return <div className="ext-setup">{pairStep}</div>;
  return (
    <div className="ext-setup">
      <div className="ext-step">
        <span className="ext-n">1</span>
        <div>
          <b>Tải tiện ích Synchro</b>
          <p>Dùng cho Chrome, Microsoft Edge, Brave và các trình duyệt nhân Chromium khác.</p>
          <a className="btn" href="/api/browser/ext/download" download><I.Download size={14} />Tải tiện ích (.zip)</a>
        </div>
      </div>
      <div className="ext-step">
        <span className="ext-n">2</span>
        <div>
          <b>Cài vào trình duyệt</b>
          <ol>
            <li>Giải nén tệp vừa tải, được thư mục <code data-notr>synchro-chrome</code></li>
            <li>Mở trang quản lý tiện ích: {["chrome", "edge", "brave"].map((b) => <button key={b} className="ext-url" onClick={() => copy(`${b}://extensions`, `Đã sao chép ${b}://extensions`)} data-tip="Sao chép, rồi dán vào thanh địa chỉ"><code data-notr>{b}://extensions</code><I.Copy size={12} /></button>)}</li>
            <li>Bật Developer mode (Chế độ dành cho nhà phát triển) ở góc trên bên phải.</li>
            <li>Bấm Load unpacked (Tải tiện ích đã giải nén) rồi chọn thư mục <code data-notr>synchro-chrome</code></li>
            <li>Bấm biểu tượng mảnh ghép trên thanh công cụ và ghim Synchro để dễ mở.</li>
          </ol>
        </div>
      </div>
      {pairStep}
    </div>
  );
}

/** Chrome của bạn trong khung trình duyệt: trạng thái, Synchro đang làm gì, Dừng; chưa có trình duyệt nào thì hướng dẫn cài. */
function ChromePanel({ ext, say, busy, onStop }: { ext: ReturnType<typeof useExt>; say: Say; busy?: boolean; onStop?: () => void }) {
  const { st, reload, setSt } = ext;
  const [more, setMore] = useState(false);
  if (!st) return <div className="bp-empty"><span className="ag-spin" />Đang kiểm tra…</div>;
  if (!st.allowed) return <div className="brw-off"><I.Globe size={28} /><b>Chrome của bạn</b><span>Máy chủ chưa bật dịch vụ workspace nên chưa nối được trình duyệt của bạn.</span></div>;
  if (!st.devices.length) return (
    <div className="ext-panel">
      <div className="ext-hero"><b>Cho Synchro làm việc trên Chrome của bạn</b><span>Giống Claude trong Chrome: cài tiện ích Synchro một lần, rồi cứ nhờ trong khung chat. Synchro tự mở trang, bấm, gõ, điền biểu mẫu ngay trên trình duyệt của bạn, với các tài khoản bạn đã đăng nhập sẵn, với mọi model.</span></div>
      <ExtSetup st={st} reload={reload} say={say} />
    </div>
  );
  const d = st.devices.find((x) => x.active) ?? st.devices.find((x) => x.connected) ?? st.devices[0];
  const acting = d.acting || (busy && d.connected && !!d.last && Date.now() - d.last.at < 30_000);
  const stop = async () => { onStop?.(); try { await post({ op: "stop" }); } catch (e) { say((e as Error).message); } reload(); };
  const remove = async (id: string, name: string) => {
    try { const j = await post({ op: "remove", id }); setSt((s) => (s ? { ...s, ...j } : s)); say(`Đã gỡ ${name}`); reload(); } catch (e) { say((e as Error).message); }
  };
  return (
    <div className="ext-panel">
      <div className={`ext-card ${d.connected ? "on" : ""} ${acting ? "acting" : ""}`}>
        <div className="ext-dev">
          <span className="ext-dot" />
          <div><b data-notr>{d.name}</b><span>{acting ? "Synchro đang điều khiển" : d.connected ? "Đã kết nối" : "Chưa kết nối: mở trình duyệt có cài tiện ích Synchro, tiện ích tự kết nối."}</span></div>
          {d.connected && <span className="ext-scope" data-tip="Đổi trong cửa sổ tiện ích Synchro trên Chrome">{d.scope === "group" ? "Nhóm tab Synchro" : "Toàn quyền · mọi tab"}</span>}
        </div>
        {d.connected && (d.tab || d.last) && (
          <div className="ext-now">
            {d.tab && <div className="ext-tab"><I.Globe size={14} /><span className="cv-ell" data-notr>{d.tab.title || hostOf(d.tab.url)}</span><code data-notr>{hostOf(d.tab.url)}</code></div>}
            {d.last && <div className="ext-last"><span>Thao tác gần nhất</span><span className="cv-ell" data-notr>{d.last.kind === "navigate" ? hostOf(d.last.label) : d.last.label}</span></div>}
          </div>
        )}
        {acting && <button className="btn dark ext-stop" onClick={stop}><I.Stop size={12} />Dừng</button>}
      </div>
      <p className="ext-note">Bạn xem trực tiếp ngay trên trình duyệt của mình. Tab Synchro đang làm có viền cam và dải “Synchro đang điều khiển tab này” với nút Dừng; Synchro tự mở trang ở tab riêng (nhóm tab “Synchro”), không đè lên tab bạn đang xem.</p>
      <div className="ext-try">
        <span>Thử nhờ trong khung chat</span>
        {["Mở Gmail trên Chrome của tôi và tóm tắt các thư chưa đọc", "Đọc trang tôi đang mở trên Chrome rồi tóm tắt", "Điền biểu mẫu đang mở trong tab của tôi bằng thông tin của tôi"].map((t) => <code key={t}>{t}</code>)}
      </div>
      <div className="ext-list">
        <div className="ext-list-h"><b>Trình duyệt đã ghép nối</b><button className="btn sm" onClick={() => setMore(!more)}>{more ? "Đóng" : "Thêm trình duyệt"}</button></div>
        {st.devices.map((x) => (
          <div key={x.id} className="ext-row">
            <span className={`ext-dot ${x.connected ? "on" : ""}`} /><span className="cv-ell" data-notr>{x.name}</span>
            <span className="ext-row-s">{x.connected ? "Đã kết nối" : "Ngoại tuyến"}</span>
            <button className="icon-btn" onClick={() => remove(x.id, x.name)} aria-label="Gỡ trình duyệt này" data-tip="Gỡ trình duyệt này"><I.Trash size={14} /></button>
          </div>
        ))}
        {more && <ExtSetup st={st} reload={reload} say={say} />}
      </div>
    </div>
  );
}

/** Khung trình duyệt: chọn trình duyệt của Synchro hay Chrome của bạn (lựa chọn này là nơi Synchro làm việc mặc định khi bạn nhờ). */
export function BrowserHub({ ticket, synchro, prefer, visible, say, onClose, onExpand, expanded, autoOpen, setAutoOpen, onStop, busy }: {
  ticket: () => Promise<string>; synchro: { available: boolean; reason?: string }; prefer?: { v: Where; n: number } | null; visible: boolean; say: Say;
  onClose?: () => void; onExpand?: () => void; expanded?: boolean; autoOpen?: boolean; setAutoOpen?: (v: boolean) => void; onStop?: () => void; busy?: boolean;
}) {
  const caps = useCaps();
  const ext = useExt(visible);
  const paired = !!ext.st?.devices.length;
  const [view, setView] = useState<Where>(() => (caps.caps.mine || !synchro.available ? "user" : "synchro"));
  // Synchro vừa bắt đầu làm ở trình duyệt nào thì khung chuyển sang trình duyệt đó.
  useEffect(() => { if (prefer) setView(prefer.v); }, [prefer?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ext.st && !prefer) setView(ext.st.target === "user" || !synchro.available ? "user" : "synchro"); }, [ext.st?.target]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = async (v: Where) => {
    setView(v);
    if (v === "synchro" && caps.caps.mine) { const e = await setCaps({ mine: false }); if (e) say(e); ext.reload(); }
    if (v === "user" && paired && !caps.caps.mine) { const e = await setCaps({ mine: true }); if (e) say(e); ext.reload(); }
  };
  const live = ext.st?.devices.find((d) => d.active) ?? ext.st?.devices.find((d) => d.connected);
  return (
    <div className="bh">
      <div className="bh-h">
        <div className="seg bh-seg" role="tablist">
          <button role="tab" aria-selected={view === "synchro"} className={view === "synchro" ? "on" : ""} onClick={() => choose("synchro")} disabled={!synchro.available} data-tip={synchro.available ? "Synchro làm việc trong trình duyệt riêng của nó, bạn xem trực tiếp ở đây" : synchro.reason}>
            <I.Globe size={13} />Trình duyệt của Synchro
          </button>
          <button role="tab" aria-selected={view === "user"} className={view === "user" ? "on" : ""} onClick={() => choose("user")} data-tip="Synchro làm việc ngay trên Chrome / Edge / Brave của bạn, với các tài khoản bạn đã đăng nhập">
            <span className={`ext-dot ${live ? "on" : ""} ${live?.acting ? "acting" : ""}`} />Chrome của bạn
          </button>
        </div>
        <div className="bh-acts">
          {onExpand && <button className="icon-btn" onClick={onExpand} aria-label={expanded ? "Thu nhỏ" : "Phóng to"} data-tip={expanded ? "Thu nhỏ" : "Phóng to"}>{expanded ? <I.Collapse size={15} /> : <I.Expand size={15} />}</button>}
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Đóng trình duyệt" data-tip="Đóng"><I.X size={15} /></button>}
        </div>
      </div>
      {view === "synchro" && synchro.available
        ? <BrowserPane ticket={ticket} visible={visible} say={say} autoOpen={autoOpen} setAutoOpen={setAutoOpen} onStop={onStop} />
        : view === "synchro" ? <div className="brw-off"><I.Globe size={28} /><b>Trình duyệt của Synchro</b><span>{synchro.reason ?? "Đang kiểm tra…"}</span></div>
        : <ChromePanel ext={ext} say={say} busy={busy} onStop={onStop} />}
    </div>
  );
}

/** Cài đặt → Khả năng → Trình duyệt của bạn: các trình duyệt đã ghép nối (gỡ được), tải tiện ích, hướng dẫn cài, ghép nối thêm. */
export function ExtSettings({ say }: { say: Say }) {
  const ext = useExt(true, 5000);
  const { st, reload, setSt } = ext;
  const [add, setAdd] = useState(false);
  if (!st) return null;
  if (!st.allowed) return null;
  const remove = async (id: string, name: string) => {
    try { const j = await post({ op: "remove", id }); setSt((s) => (s ? { ...s, ...j } : s)); say(`Đã gỡ ${name}`); reload(); } catch (e) { say((e as Error).message); }
  };
  return (
    <div className="cap-ext">
      {st.devices.length ? <>
        <div className="ext-list">
          {st.devices.map((x) => (
            <div key={x.id} className="ext-row">
              <span className={`ext-dot ${x.connected ? "on" : ""} ${x.acting ? "acting" : ""}`} /><span className="cv-ell" data-notr>{x.name}</span>
              <span className="ext-row-s">{x.acting ? "Synchro đang điều khiển" : x.connected ? (x.scope === "group" ? "Đã kết nối · nhóm tab Synchro" : "Đã kết nối · toàn quyền") : "Ngoại tuyến"}</span>
              <button className="icon-btn" onClick={() => remove(x.id, x.name)} aria-label="Gỡ trình duyệt này" data-tip="Gỡ trình duyệt này"><I.Trash size={14} /></button>
            </div>
          ))}
        </div>
        <div className="ext-list-h" style={{ margin: "6px 0" }}>
          <a className="btn sm" href="/api/browser/ext/download" download><I.Download size={13} />Tải tiện ích (.zip)</a>
          <button className="btn sm" onClick={() => setAdd(!add)}>{add ? "Đóng" : "Thêm trình duyệt"}</button>
        </div>
        {add && <ExtSetup st={st} reload={reload} say={say} />}
      </> : <ExtSetup st={st} reload={reload} say={say} />}
    </div>
  );
}
