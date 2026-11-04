"use client";
// Cài đặt → Providers: mỗi hãng (Claude, ChatGPT, Gemini, Grok, DeepSeek) là một mục. Bấm vào để chọn cách dùng:
// - Đăng nhập gói subscription của chính mình: máy chủ chạy CLI chính chủ (Claude Code, Codex, Antigravity, Grok CLI), Synchro chỉ hiện link
//   đăng nhập và nhận mã người dùng dán vào; thông tin đăng nhập nằm trong thư mục riêng của tài khoản trên máy chủ.
// - Liên kết khóa API (chỉ quản trị viên): khóa dùng chung cho cả hệ thống, kèm số dư đã nạp.
// Chọn cách nào thì mới hiện các bước của cách đó. DeepSeek (không có gói đăng nhập) và ElevenLabs chỉ dùng khóa API.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { call } from "./adminui";
import { refreshModels, useModels } from "./models";
import { BrandLogo } from "./brands";
import { ProviderCard, TestBox, type ApiProvider, type ApiState } from "./apiui";
import { locale } from "./i18n";

type Cli = "claude" | "codex" | "agy" | "grok";
type Login = { state: "starting" | "open_url" | "verifying" | "done" | "error"; method: string | null; url?: string; userCode?: string; needsCode: boolean; message?: string; startedAt: number };
export type EngineStatus = { cli: Cli; installed: boolean; version: string | null; loggedIn: boolean; method: string | null; relogin?: boolean; detail?: string; login: Login | null; blockedUntil?: number | null; usingApiUntil?: number | null; apiModel?: string | null; setup?: boolean };

// cli: null khi hãng không có gói đăng nhập (DeepSeek chỉ có khóa API).
const VENDORS: { id: string; cli: Cli | null; name: string; vendor: string; plan: string; via: string }[] = [
  { id: "anthropic", cli: "claude", name: "Claude", vendor: "Anthropic", plan: "Claude Pro or Max plan", via: "Claude Code" },
  { id: "openai", cli: "codex", name: "ChatGPT", vendor: "OpenAI", plan: "ChatGPT Plus, Pro or Business plan", via: "Codex CLI" },
  { id: "google", cli: "agy", name: "Gemini", vendor: "Google", plan: "Google AI Pro or Ultra plan", via: "Antigravity CLI" },
  { id: "xai", cli: "grok", name: "Grok", vendor: "xAI", plan: "SuperGrok or X Premium+ plan", via: "Grok CLI" },
  { id: "deepseek", cli: null, name: "DeepSeek", vendor: "DeepSeek", plan: "", via: "" },
];
type Vendor = (typeof VENDORS)[number];
type PlanVendor = Vendor & { cli: Cli };
const METHOD: Record<string, string> = { token: "long-lived token", oauth: "claude.ai account", chatgpt: "ChatGPT account", apikey: "API key", google: "Google account", grok: "Grok account" };
const when = (t: number) => new Date(t).toLocaleString(locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** Trạng thái CLI của chính tài khoản cho một hãng (hãng không có gói: không hỏi gì). */
function usePlan(cli: Cli | null) {
  const [st, setSt] = useState<EngineStatus | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback((fresh = false) => (cli ? call<EngineStatus>("GET", `/api/engines/${cli}/status${fresh ? "?fresh=1" : ""}`) : Promise.reject(new Error("No plan sign-in for this provider."))).then((s) => { setSt(s); return s; }), [cli]);
  useEffect(() => { if (cli) load().catch((e) => setErr(e.message)); }, [load, cli]);
  return { st, setSt, load, err, setErr };
}

// ---------------------------------------------------------------- đăng nhập gói subscription
function PlanPane({ v, admin, plan }: { v: PlanVendor; admin: boolean; plan: ReturnType<typeof usePlan> }) {
  const app = useApp();
  const models = useModels();
  const { st, setSt, load, err, setErr } = plan;
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState<"" | "start" | "code" | "install" | "out" | "mode">("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const base = `/api/engines/${v.cli}`;
  const done = useCallback(async () => {
    setLogin(null); setCode("");
    await load(true).catch(() => null);
    await refreshModels();
    app.say(`Signed in to ${v.name}. Its models are now in the model picker.`);
  }, [load, app, v.name]);
  // Codex, Grok: người dùng nhập / xác nhận mã trên trang của hãng, CLI tự hoàn tất; hỏi lại trạng thái mỗi 2 giây.
  // Hàm gọi lại đọc qua ref để vòng hỏi không bị tạo lại (và ngừng) mỗi khi context của ứng dụng đổi.
  const polling = login?.state === "open_url" && !login.needsCode;
  const cb = useRef({ load, done, setErr });
  cb.current = { load, done, setErr };
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const t = setInterval(() => {
      cb.current.load(true).then((s) => {
        if (stop) return;
        if (s.login?.state === "done" || s.loggedIn) { stop = true; clearInterval(t); cb.current.done(); }
        // Máy chủ không còn lượt đăng nhập này: lượt đăng nhập nằm trong bộ nhớ tiến trình, deploy giữa chừng là mất (không phải bạn làm sai).
        else if (s.login?.state === "error" || !s.login) { stop = true; clearInterval(t); setLogin(null); cb.current.setErr(s.login ? s.login.message ?? "Sign-in failed." : "The server restarted during sign-in. Click Sign in to start again."); }
      }).catch(() => {});
    }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [polling]);

  const start = async (method?: string) => {
    setBusy("start"); setErr(""); setCode("");
    try {
      const l = await call<Login>("POST", `${base}/login/start`, method ? { method } : {});
      if (l.state === "error") setErr(l.message ?? "Sign-in failed."); else setLogin(l);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const submit = async () => {
    if (!code.trim()) return;
    setBusy("code"); setErr("");
    try {
      const l = await call<Login>("POST", `${base}/login/code`, { code: code.trim() });
      if (l.state === "done") await done();
      else { setErr(l.message ?? "The code was not accepted."); setLogin(null); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); setCode(""); }
  };
  const cancel = () => { setLogin(null); setCode(""); call("DELETE", `${base}/login/start`).catch(() => {}); };
  const install = async () => {
    setBusy("install"); setErr("");
    try {
      const r = await call<{ ok: boolean; version: string | null; output: string }>("POST", `${base}/install`);
      if (!r.ok) setErr(r.output.split("\n").filter(Boolean).slice(-3).join("\n") || "Install failed.");
      else app.say(`Installed ${v.via} ${r.version ?? ""}`.trim());
      await load(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const logout = () => app.confirm(`Sign out of ${v.name}?`, `Synchro removes this sign-in from the server. ${v.name} models from your plan disappear from the model picker until you sign in again.`, "Sign out", async () => {
    setBusy("out");
    try { setSt(await call<EngineStatus>("POST", `${base}/logout`)); await refreshModels(); app.say(`Signed out of ${v.name}`); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  });
  // Dùng khóa API thay gói (chỉ khi người dùng bấm) hoặc quay lại gói.
  const useApi = async (on: boolean) => {
    setBusy("mode");
    try { await call("POST", `${base}/use-api`, { on }); await load(true); await refreshModels(); app.say(on ? `${v.name} now uses the shared API key until your plan resets` : `${v.name} is back on your plan`); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  };
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  const mine = models.providers.find((x) => x.plan?.cli === v.cli)?.plan?.models ?? [];
  const hasApi = !!st?.apiModel;
  const state = !st ? (err ? "Couldn't check" : "Checking…") : !st.installed ? "Not installed" : st.relogin ? "Sign in again" : st.loggedIn ? "Signed in" : "Not signed in";
  return (
    <div className="pv-pane">
      <div className="pv-pane-h">
        <div className="api-meta">
          <div className="api-sub">{st?.loggedIn ? `Signed in with your ${METHOD[st.method ?? ""] ?? "account"}${mine.length ? ` · ${mine.length} models` : ""}` : `${v.plan} · ${v.via}`}</div>
        </div>
        <span className={`api-badge ${st?.loggedIn && !st.relogin ? "ok" : st?.relogin ? "bad" : ""}`}><i />{state}</span>
        <div className="api-btns">
          {st && !st.installed && admin && <button className="btn dark" onClick={install} disabled={!!busy}>{busy === "install" ? <><span className="api-spin" />Installing…</> : "Install"}</button>}
          {st?.installed && (!st.loggedIn || st.relogin) && !login && <button className="btn dark" onClick={() => start()} disabled={!!busy}>{busy === "start" ? <><span className="api-spin" />Starting…</> : "Sign in"}</button>}
          {st?.loggedIn && !login && <button className="btn" onClick={logout} disabled={!!busy}>{busy === "out" ? <span className="api-spin" /> : "Sign out"}</button>}
        </div>
      </div>
      {st && !st.installed && !admin && <p className="pv-note">{`An administrator needs to install ${v.via} on the server first.`}</p>}
      {busy === "install" && <p className="pv-note">{`Downloading the official ${v.via}. This can take a minute.`}</p>}
      {err && <div className="api-err in" role="alert"><I.Alert size={14} /><span>{err}</span></div>}
      {st?.loggedIn && !login && st.setup && (
        <div className="pv-mode warn"><span>Antigravity is waiting for you to finish its first-run setup: pick a color scheme, then accept its terms and choose whether Google may use your interactions. Synchro never answers these for you. Until then, chat works but plan limits can&apos;t be read.</span></div>
      )}
      {st?.loggedIn && !login && st.usingApiUntil && (
        <div className="pv-mode"><span>{`Using the shared API key instead of your plan until ${when(st.usingApiUntil)}.`}</span><button className="btn" onClick={() => useApi(false)} disabled={!!busy}>Back to my plan</button></div>
      )}
      {st?.loggedIn && !login && !st.usingApiUntil && st.blockedUntil && (
        <div className="pv-mode warn"><span>{`Your plan hit its limit. It resets ${when(st.blockedUntil)}.`}</span>{hasApi && <button className="btn" onClick={() => useApi(true)} disabled={!!busy}>Use the shared API key</button>}</div>
      )}
      {login && (
        <div className="api-form pv-flow">
          <ol className="pv-steps">
            <li>
              <b>{`Open the ${v.name} sign-in page`}</b>
              <span>{v.cli === "codex" ? "Sign in to ChatGPT, then enter the one-time code below." : v.cli === "grok" ? "Sign in with the account that has your SuperGrok or X Premium+ plan, then confirm the code below." : `Sign in with the account that has your ${v.plan.replace(/ plan$/, "")}, then copy the code the page shows you.`}</span>
              {login.url && <a className="btn dark pv-open" href={login.url} target="_blank" rel="noreferrer noopener">Open sign-in page<I.External size={12} /></a>}
            </li>
            {login.userCode && (
              <li>
                <b>{v.cli === "grok" ? "Check this code" : "Enter this code"}</b>
                <span>{v.cli === "grok" ? "The sign-in page should show the same code. It expires in 10 minutes. Never share it with anyone." : "It expires in 15 minutes. Never share it with anyone."}</span>
                <div className="pv-code"><code data-notr>{login.userCode}</code><button className="icon-btn" aria-label="Copy code" data-tip={copied ? "Copied" : "Copy code"} onClick={() => copy(login.userCode!)}>{copied ? <I.M icon="Check" size={15} /> : <I.M icon="Copy" size={15} />}</button></div>
                <span className="pv-wait"><span className="api-spin" />Waiting for you to approve…</span>
              </li>
            )}
            {login.needsCode && (
              <li>
                <b>Paste the code here</b>
                <span>Use the code from the page you just opened. Each time you press Sign in, a new link is created and older codes stop working.</span>
                <form className="pv-paste" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                  <input className="field" autoComplete="off" spellCheck={false} placeholder="Paste the code from the sign-in page" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
                  <button type="submit" className="btn dark" disabled={!code.trim() || busy === "code"}>{busy === "code" ? <><span className="api-spin" />Checking…</> : "Continue"}</button>
                </form>
              </li>
            )}
          </ol>
          <div className="api-actions">
            {v.cli === "claude" && login.method === "token" && <button className="api-adv pv-alt" onClick={() => start("oauth")}>Use claude.ai sign-in instead</button>}
            <button className="btn" onClick={cancel}>Cancel</button>
          </div>
          <p className="api-note"><I.Lock size={12} /><span>{v.cli === "claude" && login.method === "token" ? "Claude Code creates a long-lived sign-in token for this account. Synchro stores it encrypted and only hands it to Claude Code." : `${v.via} keeps your sign-in in a folder only your account uses on the server.`}</span></p>
        </div>
      )}
      {st?.loggedIn && mine.length > 0 && !login && <div className="api-chips">{mine.map((m) => <span key={m.key} className="api-chip" data-notr>{m.name}</span>)}</div>}
      {!login && <p className="pv-note pv-hint">Synchro never switches from your plan to an API key on its own. When your plan hits its limit, it asks you first.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- mục của một hãng
function VendorItem({ v, admin, api, apiState, setApi }: { v: Vendor; admin: boolean; api?: ApiProvider; apiState: ApiState | null; setApi: (s: ApiState) => void }) {
  const plan = usePlan(v.cli);
  // Mở sẵn hãng người dùng vừa chọn ở thẻ làm quen của trang chủ.
  const [open, setOpen] = useState(() => { try { if (sessionStorage.getItem("pv-open") !== v.id) return false; sessionStorage.removeItem("pv-open"); return true; } catch { return false; } });
  // Hãng chỉ có khóa API: mở ra là thấy luôn phần khóa API.
  const [mode, setMode] = useState<"plan" | "api" | null>(v.cli ? null : "api");
  const st = plan.st;
  const planText = !st ? (plan.err ? "Couldn't check" : "Checking…") : !st.installed ? "Not installed" : st.relogin ? "Sign in again" : st.loggedIn ? "Signed in" : "Not signed in";
  const apiText = !api ? "" : !api.configured ? "Not connected" : api.status === "error" ? "Needs attention" : `Connected · ${api.models.length} models`;
  const credit = apiState?.credits?.find((c) => c.provider === v.id) ?? null;
  return (
    <div className={`api-card pv-vendor ${open ? "open" : ""}`} data-vendor={v.id}>
      <button className="pv-vendor-h" aria-expanded={open} onClick={() => { setOpen(!open); if (open) setMode(v.cli ? null : "api"); }}>
        <span className="api-mark" aria-hidden data-notr><BrandLogo id={v.id} size={20} /></span>
        <span className="api-meta">
          <span className="api-name"><b>{v.name}</b>{v.vendor !== v.name && <span className="api-vendor">{v.vendor}</span>}</span>
          <span className="pv-sum">
            {v.cli ? <span className={`pv-tag ${st?.loggedIn && !st.relogin ? "ok" : ""}`}><i />{`Plan: ${planText}`}</span> : <span className="pv-tag"><i />API key only</span>}
            {admin && api && <span className={`pv-tag ${api.configured && api.status !== "error" ? "ok" : ""}`}><i />{`API: ${apiText}`}</span>}
          </span>
        </span>
        <I.ChevronR size={16} />
      </button>
      {open && (
        <div className="pv-body">
          {!v.cli && <p className="pv-note">{`${v.name} has no plan sign-in for other apps, so it connects with an API key only.`}</p>}
          <div className="pv-choose" role="radiogroup" aria-label={`How to use ${v.name}`}>
            {v.cli && (
              <button role="radio" aria-checked={mode === "plan"} className={`pv-opt ${mode === "plan" ? "on" : ""}`} onClick={() => setMode("plan")}>
                <I.SetAccount size={18} />
                <span><b>Sign in with your plan</b><em>{`Use your own ${v.plan}. Only your account uses it.`}</em></span>
              </button>
            )}
            {admin && (
              <button role="radio" aria-checked={mode === "api"} className={`pv-opt ${mode === "api" ? "on" : ""}`} onClick={() => setMode("api")}>
                <I.SetKey size={18} />
                <span><b>Link an API key</b><em>Shared with everyone on this Synchro, billed to the key.</em></span>
              </button>
            )}
          </div>
          {mode === "plan" && v.cli && <PlanPane v={v as PlanVendor} admin={admin} plan={plan} />}
          {mode === "api" && admin && (api ? <ProviderCard p={api} onChange={setApi} credit={credit} bare /> : <p className="pv-note">Loading…</p>)}
        </div>
      )}
    </div>
  );
}

export function ProvidersPanel() {
  const me = useApp().me;
  const admin = !!me?.isAdmin;
  // Máy chủ chỉ chạy bằng gói (không có khóa API dùng chung): không nói về khóa dùng chung như thể đang có.
  const shared = useModels().sharedApi;
  const [api, setApi] = useState<ApiState | null>(null);
  const [apiErr, setApiErr] = useState("");
  useEffect(() => { if (admin) call<ApiState>("GET", "/api/admin/apikeys").then(setApi).catch((e) => setApiErr(e.message)); }, [admin]);
  const update = (s: ApiState) => { setApi(s); refreshModels(); };
  const others = api?.providers.filter((p) => !VENDORS.some((v) => v.id === p.id)) ?? [];
  return (
    <>
      <div className="adm-head">
        <div className="adm-badge"><I.SetChip size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s-title">Providers</div>
          <div className="d">{admin && shared ? "Connect Claude, ChatGPT, Gemini, Grok and DeepSeek with your own plan or with an API key shared by everyone." : admin ? "Connect Claude, ChatGPT, Gemini and Grok with your own plan. No shared API key is linked right now, so each person signs in with their own plan." : "Use the AI plans you already pay for. Sign in once and every model your plan allows shows up in the model picker, only for your account."}</div>
        </div>
      </div>
      {apiErr && <div className="api-err" role="alert"><I.Alert size={14} /><span>{apiErr}</span></div>}
      {/* Hãng chỉ có khóa API (DeepSeek): chỉ quản trị viên nối được nên chỉ hiện cho quản trị viên. */}
      <div className="api-list">{VENDORS.filter((v) => admin || v.cli).map((v) => <VendorItem key={v.id} v={v} admin={admin} api={api?.providers.find((p) => p.id === v.id)} apiState={api} setApi={update} />)}</div>
      {admin && api && others.length > 0 && (
        <>
          <h3 className="sec">Other providers</h3>
          <p className="d pv-shared-d">API key only. Voice (ElevenLabs) works with an API key only.</p>
          <div className="api-list">{others.map((p) => <ProviderCard key={p.id} p={p} onChange={update} credit={p.id === "elevenlabs" ? undefined : api.credits?.find((c) => c.provider === p.id) ?? null} />)}</div>
        </>
      )}
      {admin && api && (
        <>
          <h3 className="sec">Test a model</h3>
          <TestBox catalog={api.catalog} />
        </>
      )}
      <h3 className="sec">How it works</h3>
      <ol className="api-steps pv-how">
        <li><b>Pick a provider, then how to connect it</b><span>{admin && shared ? "Sign in with your own plan, or link an API key that everyone on this Synchro can use." : "Sign in with your own plan. Synchro runs the provider's official app on the server and shows you its sign-in link. Your password never passes through Synchro."}</span></li>
        <li><b>Chat with it</b><span>{shared ? "The model picker keeps one group per provider. A group shows your plan's models while you are signed in, otherwise the shared API models." : "The model picker keeps one group per provider and shows your plan's models while you are signed in."}</span></li>
        <li><b>When your plan runs out</b><span>{shared ? "Synchro asks before switching to the shared API key. You switch back to your plan automatically when it resets." : "Synchro shows when the plan resets. Until then you can keep going with another provider's plan if you signed in to one."}</span></li>
      </ol>
    </>
  );
}
