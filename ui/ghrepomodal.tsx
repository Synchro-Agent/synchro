"use client";
// Hộp thoại "Repo GitHub" của Synchro Code: kết nối GitHub, rồi chọn hoặc dán repo để clone vào workspace của phiên.
// Danh sách (RepoList, dùng chung với "Thêm từ GitHub" của Dự án) gồm mọi repo người dùng truy cập được, nhóm theo chủ
// (cá nhân, từng tổ chức, repo được mời cộng tác), tìm trên toàn bộ danh sách và tải thêm theo trang. Tổ chức đang
// chặn Synchro có nút mở đúng trang GitHub để gỡ chặn; quay lại cửa sổ này thì danh sách tự đọc lại.
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tf, tr, trc } from "./i18n";
import { ghConnect, ghOutside, ghRepos, ghStatus, ghUnlink, gitOp, WsError, type GhFix, type GhGroup, type GhRepo,
  type GhRepoPage, type GhStatus, type GitState } from "./wsclient";
import { Spinner } from "./spinner";

type Say = (m: string) => void;
type Block = NonNullable<GhGroup["block"]>;
type Err = { msg: string; fix?: GhFix; reconnect?: boolean };
// Lỗi từ máy chủ giữ cả cách sửa: fix = nút mở trang GitHub, reconnect = nút Kết nối lại.
const errOf = (e: unknown): Err => {
  const x = e instanceof WsError ? e.extra : {};
  return { msg: (e as Error).message, fix: x.fix, reconnect: x.reconnect };
};
// Một dòng cho mỗi cách GitHub chặn: điều cần làm và nhãn nút mở trang GitHub.
const BLOCK_NOTE: Record<Block, string> = {
  oauth: "Tổ chức chưa cho Synchro truy cập. Chủ tổ chức bấm Grant trên GitHub.",
  sso: "Tổ chức bật SAML SSO. Cho phép Synchro dùng kết nối với tổ chức này.",
  app: "Ứng dụng Synchro chưa được cài vào tổ chức này.",
};
// Nhãn ngắn dịch theo ngữ cảnh: khóa trần "Cấp quyền" sẽ đổi mọi nút cùng chữ ở chỗ khác của trang.
const blockBtn = (b: Block) =>
  b === "oauth" ? trc("Cấp quyền", "repo GitHub") : b === "sso" ? tr("Cho phép") : tr("Cài vào tổ chức");
// Lời báo khi clone repo của tổ chức đang chặn: một câu có tên tổ chức, nút bên cạnh nói việc cần bấm.
const fixMsg = (f: GhFix) => f.block === "oauth" ? tf("Tổ chức {org} chưa cấp quyền cho Synchro.", { org: f.org })
  : f.block === "sso" ? tf("Tổ chức {org} bật SAML SSO, cần cho phép Synchro dùng kết nối GitHub.", { org: f.org })
  : tf("Ứng dụng Synchro chưa được cài vào tổ chức {org}.", { org: f.org });

// Đã mở trang GitHub (gỡ chặn, kết nối): lần cửa sổ được chọn lại thì gọi back (đọc lại từ GitHub).
function useBack(back: () => void) {
  const away = useRef(false);
  const cb = useRef(back);
  cb.current = back;
  useEffect(() => {
    const on = () => {
      if (!away.current) return;
      away.current = false;
      cb.current();
    };
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, []);
  return () => { away.current = true; };
}

function FixLink({ url, label, onOpen, small }: { url: string; label: string; onOpen: () => void; small?: boolean }) {
  return (
    <a className={`btn gh-fix${small ? " sm" : ""}`} href={url} target="_blank" rel="noreferrer" onClick={onOpen}>
      {label}<I.External size={13} />
    </a>
  );
}

export function ErrBox({ err, connect, onOpen }: { err: Err; connect: () => void; onOpen: () => void }) {
  return (
    <div className="gh-err" role="alert">
      <span>{err.fix ? fixMsg(err.fix) : err.msg}</span>
      {err.fix && <FixLink url={err.fix.url} label={blockBtn(err.fix.block)} onOpen={onOpen} />}
      {err.reconnect && !err.fix && <button className="btn dark" onClick={connect}>Kết nối lại</button>}
    </div>
  );
}

const EMPTY: GhRepoPage = { repos: [], groups: [], total: 0, page: 1, more: false };

/** Ô tìm và danh sách mọi repo GitHub của tài khoản đã kết nối. pick: bấm một repo. reloadKey đổi: đọc lại từ GitHub
 *  (vừa kết nối lại). onBack: người dùng quay lại sau khi mở trang GitHub để gỡ chặn (nơi gọi đọc lại trạng thái).
 *  onMissing: quyền còn thiếu theo token thật mà GitHub vừa báo (người dùng có thể đã thu hồi bớt). */
export function RepoList({ pick, login, busy = "", connect, reloadKey = 0, onBack, onMissing, autoFocus }: {
  pick: (r: GhRepo) => void; login: string | null; busy?: string; connect: () => void; reloadKey?: number;
  onBack?: () => void; onMissing?: (m: string[]) => void; autoFocus?: boolean;
}) {
  const [list, setList] = useState<GhRepoPage | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const fresh = useRef(false);
  // Mỗi lượt hỏi danh sách (gõ tìm, tải lại) mang một số; trả lời của lượt cũ về sau (danh sách đầu tiên chậm vài
  // giây, các lượt cùng chờ một bản đọc GitHub) bị bỏ qua để không đè kết quả của từ khóa đang gõ.
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      const refresh = fresh.current;
      fresh.current = false;
      ghRepos(q, 1, refresh).then((p) => {
        if (my !== seq.current) return;
        setList(p); setErr(null);
        if (p.missing) onMissing?.(p.missing);
      }).catch((e) => {
        if (my !== seq.current) return;
        setErr(errOf(e)); setList(EMPTY);
      });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, nonce]);
  const reload = () => { fresh.current = true; setList(null); setErr(null); setNonce((n) => n + 1); };
  // So với lần trước thay vì cờ "lần đầu": chế độ Strict của React chạy effect hai lần khi gắn, cờ sẽ tải lại thừa.
  const lastKey = useRef(reloadKey);
  useEffect(() => {
    if (lastKey.current === reloadKey) return;
    lastKey.current = reloadKey;
    reload();
  }, [reloadKey]);
  const opened = useBack(() => { onBack?.(); reload(); });
  const loadMore = async () => {
    if (!list || more) return;
    const my = seq.current;
    setMore(true);
    try {
      const next = await ghRepos(q, list.page + 1);
      if (my === seq.current) setList((cur) => cur && { ...next, repos: [...cur.repos, ...next.repos] });
    } catch (e) { if (my === seq.current) setErr(errOf(e)); }
    setMore(false);
  };
  const groupOf = (owner: string) => list?.groups.find((g) => g.owner === owner);
  const me = (login ?? "").toLowerCase();
  const kindLabel = (g: GhGroup) => g.type === "org" ? trc("Tổ chức", "repo GitHub")
    : g.owner.toLowerCase() === me ? trc("Cá nhân", "repo GitHub") : trc("Cộng tác", "repo GitHub");
  // Tổ chức bị chặn mà không có repo nào hiện ra: liệt kê ở đầu danh sách để thấy ngay cách gỡ chặn.
  const blockedEmpty = (list?.groups ?? []).filter((g) => g.block && g.count === 0);
  // Chỉ dòng tên nhóm dính ở đầu khung khi cuộn. Tổ chức chặn mà vẫn thấy repo (repo công khai): nút gỡ chặn gọn
  // trong dòng tên; chưa thấy repo nào: thêm một dòng giải thích cuộn theo danh sách.
  const head = (g: GhGroup) => [
    <div className={`gh-grp${g.block ? " blocked" : ""}`} key={`h-${g.owner}`}>
      <div className="gh-grp-t">
        {g.type === "org" ? <I.Users size={14} /> : <I.User size={14} />}
        <b data-notr>{g.owner}</b><span>{kindLabel(g)}</span>
        {g.block && g.count > 0 && g.fixUrl && (
          <span className="gh-grp-k" data-tip={tr(BLOCK_NOTE[g.block])}>
            <I.Lock size={12} /><FixLink url={g.fixUrl} label={blockBtn(g.block)} onOpen={opened} small />
          </span>
        )}
        {g.count > 0 && <span className="gh-grp-n">{g.count}</span>}
      </div>
    </div>,
    g.block && g.count === 0 ? (
      <div className="gh-grp-b" key={`b-${g.owner}`}>
        <I.Lock size={13} /><span>{tr(BLOCK_NOTE[g.block])}</span>
        {g.fixUrl && <FixLink url={g.fixUrl} label={blockBtn(g.block)} onOpen={opened} />}
      </div>
    ) : null,
  ];
  const rows: React.ReactNode[] = [];
  if (list) {
    for (const g of blockedEmpty) rows.push(...head(g));
    let cur = "";
    for (const r of list.repos) {
      const owner = r.owner ?? r.full.split("/")[0];
      if (owner !== cur) {
        cur = owner;
        const g = groupOf(owner);
        if (g) rows.push(...head(g));
      }
      rows.push(
        <button key={r.full} className="gh-repo" disabled={!!busy} onClick={() => pick(r)}>
          <span className="gh-repo-n">
            <b data-notr>{r.full.slice(owner.length + 1)}</b>{r.private && <em>Riêng tư</em>}
          </span>
          {r.desc && <span className="gh-repo-d" data-notr>{r.desc}</span>}
          {busy === r.full && <span className="gh-repo-s"><Spinner className="ag-spin" />Đang clone…</span>}
        </button>,
      );
    }
  }
  return <>
    <div className="gh-search"><I.Search size={15} />
      <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus}
        placeholder="Tìm trong mọi repo bạn truy cập được" />
      <button className="icon-btn" onClick={reload} disabled={!list} aria-label={tr("Tải lại danh sách repo")}
        title={tr("Tải lại danh sách repo")}><I.Retry size={15} /></button>
    </div>
    <div className="gh-list">
      {/* Lỗi khi tải trang đầu: chỉ lời báo (danh sách rỗng). Lỗi khi Xem thêm: lời báo ở trên,
          các repo đã tải giữ nguyên. */}
      {err && <ErrBox err={err} connect={connect} onOpen={opened} />}
      {!list ? !err && <span className="gh-note">Đang tải danh sách repo…</span>
        : !rows.length ? !err && <span className="gh-note">{q ? "Không có repo nào khớp." : "Không có repo nào."}</span>
        : rows}
      {list?.more && !err && (
        <button className="gh-more" onClick={loadMore} disabled={more}>
          {more ? "Đang tải…" : tf("Xem thêm ({n} repo nữa)", { n: list.total - list.repos.length })}
        </button>
      )}
      {list?.truncated && !err && (
        <p className="gh-note gh-trunc">
          Danh sách chưa đủ mọi repo (tài khoản rất nhiều repo hoặc GitHub ngắt giữa chừng). Tìm theo tên hoặc dán
          owner/repo vào ô ở trên.
        </p>
      )}
    </div>
  </>;
}

/** Chờ kết nối GitHub (kể cả khi trang cấp quyền mở ở trình duyệt của máy), hủy được, tự hủy khi đóng hộp thoại. */
export function useGhConnect(done: (e: string | null) => void) {
  const [waiting, setWaiting] = useState(false);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const start = async () => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setWaiting(true);
    const e = await ghConnect(c.signal);
    if (ac.current !== c) return;
    ac.current = null;
    setWaiting(false);
    if (e !== "cancel") done(e);
  };
  return { waiting, start, cancel: () => ac.current?.abort() };
}

/** Lời mời làm nốt ở trình duyệt khi ứng dụng máy tính mở trang cấp quyền GitHub ở đó. */
export function OutsideWait({ cancel }: { cancel: () => void }) {
  return (
    <div className="gh-scope gh-wait" role="status">
      <Spinner className="ag-spin" />
      <span>Hoàn tất bước cấp quyền GitHub trong trình duyệt vừa mở. Synchro tự cập nhật khi xong.</span>
      <button className="btn" onClick={cancel}>Hủy</button>
    </div>
  );
}

export function RepoModal({ git, ensureSid, say, onClose, onCloned }: {
  git?: GitState; ensureSid: () => number; say: Say; onClose: () => void; onCloned: (g: GitState) => void;
}) {
  const [st, setSt] = useState<GhStatus | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState<Err | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [missingNow, setMissingNow] = useState<string[] | null>(null);
  const load = () => ghStatus().then((s) => { setSt(s); setMissingNow(null); })
    .catch((e) => setErr({ msg: (e as Error).message }));
  useEffect(() => { load(); }, []);
  const opened = useBack(() => { setErr(null); void load(); setReloadKey((k) => k + 1); });
  const gh = useGhConnect(async (e) => {
    if (e && e !== "timeout") return setErr({ msg: e });
    if (!e) say("Đã kết nối GitHub");
    // Chưa có tin: người dùng có thể còn đang cấp quyền ở cửa sổ khác, lần quay lại sau đọc lại lần nữa.
    else opened();
    // Kết nối lại khi đã kết nối (cấp thêm quyền): token mới nên đọc lại danh sách; lần đầu thì danh sách tự tải.
    if (st?.linked) setReloadKey((k) => k + 1);
    await load();
  });
  const connect = () => { setErr(null); void gh.start(); };
  const clone = async (repo: string, branch?: string) => {
    if (!repo.trim()) return;
    setBusy(repo); setErr(null);
    try {
      const g = await gitOp(ensureSid(), "clone", { repo, branch });
      say(`Đã clone ${g.git && g.repo ? g.repo : repo}`);
      onCloned(g);
    } catch (e) { setErr(errOf(e)); }
    setBusy("");
  };
  const has = git?.git && git.repo;
  const missing = missingNow ?? st?.missing ?? [];
  const waitLabel = gh.waiting ? "Đang chờ GitHub…" : null;
  return (
    <div className="overlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !busy && !gh.waiting) onClose();
    }}>
      <div className="modal gh-modal" role="dialog" aria-modal="true" aria-label={tr("Repo GitHub")}>
        <div className="gh-head"><I.GitHub size={22} />
          <div>
            <h2>Repo GitHub</h2>
            <p>Clone repo vào workspace của phiên này để agent đọc, sửa, chạy và kiểm tra code.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={tr("Đóng")}><I.X size={18} /></button></div>
        {has ? (
          <div className="gh-cur">
            <div><b data-notr>{git.repo}</b><span><I.Branch size={13} />{git.branch}</span></div>
            <a className="btn" href={`https://github.com/${git.repo}`} target="_blank" rel="noreferrer">
              <I.External size={14} />Mở trên GitHub
            </a>
            <p className="gh-note">Mỗi phiên gắn với một repo. Muốn làm repo khác, hãy tạo phiên mới.</p>
          </div>
        ) : <>
          <div className="gh-acc">
            {!st ? <span className="gh-note">Đang tải…</span>
              : st.linked ? <>
                <span className="gh-ok"><I.Check size={14} />Đã kết nối <b data-notr>@{st.login}</b></span>
                <button className="gh-lnk" onClick={async () => {
                  await ghUnlink(); load(); say("Đã ngắt kết nối GitHub");
                }}>Ngắt kết nối</button>
              </>
              : st.configured ? <>
                <span className="gh-note">Kết nối tài khoản GitHub để clone repo riêng tư và push code.</span>
                <button className="btn dark" disabled={gh.waiting} onClick={connect}>
                  <I.GitHub size={15} />{waitLabel ?? "Kết nối GitHub"}
                </button>
              </>
              : <span className="gh-note">Máy chủ chưa bật đăng nhập GitHub nên chỉ clone được repo công khai.</span>}
          </div>
          {gh.waiting && ghOutside() && <OutsideWait cancel={gh.cancel} />}
          {st?.linked && missing.length > 0 && !gh.waiting && (
            <div className="gh-scope" role="status">
              <span>{missing.includes("repo")
                ? "Kết nối lại GitHub một lần để Synchro đọc được repo riêng tư và repo của tổ chức."
                : "Kết nối lại GitHub một lần để Synchro thấy repo của mọi tổ chức bạn tham gia."}</span>
              <button className="btn dark" onClick={connect}>Kết nối lại</button>
            </div>
          )}
          <div className="gh-url">
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") clone(url); }}
              placeholder="owner/repo hoặc https://github.com/owner/repo" />
            <button className="btn dark" disabled={!url.trim() || !!busy} onClick={() => clone(url)}>
              {busy && busy === url ? "Đang clone…" : "Clone"}
            </button>
          </div>
          {st?.linked && (
            <RepoList pick={(r) => clone(r.full)} login={st.login} busy={busy} connect={connect}
              reloadKey={reloadKey} onBack={() => { setErr(null); void load(); }} onMissing={setMissingNow} />
          )}
        </>}
        {err && <ErrBox err={err} connect={connect} onOpen={opened} />}
      </div>
    </div>
  );
}
