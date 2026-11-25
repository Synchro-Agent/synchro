"use client";
// Hộp thoại "Repo GitHub" của Synchro Code: kết nối GitHub, rồi chọn hoặc dán repo để clone vào workspace của phiên.
// Danh sách gồm mọi repo người dùng truy cập được, nhóm theo chủ (cá nhân, từng tổ chức, repo được mời cộng tác),
// tìm trên toàn bộ danh sách và tải thêm theo trang. Tổ chức đang chặn Synchro hiện một dòng kèm nút mở đúng
// trang GitHub để gỡ chặn; quay lại cửa sổ này thì danh sách tự đọc lại.
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tf, tr, trc } from "./i18n";
import { ghConnect, ghRepos, ghStatus, ghUnlink, gitOp, WsError, type GhFix, type GhGroup, type GhRepoPage,
  type GhStatus, type GitState } from "./wsclient";

type Say = (m: string) => void;
type Block = NonNullable<GhGroup["block"]>;
// Một dòng cho mỗi cách GitHub chặn: điều cần làm và nhãn nút mở trang GitHub.
const BLOCK_NOTE: Record<Block, string> = {
  oauth: "Tổ chức chưa cho Synchro truy cập. Chủ tổ chức bấm Grant trên GitHub.",
  sso: "Tổ chức bật SAML SSO. Cho phép Synchro dùng kết nối với tổ chức này.",
  app: "Ứng dụng Synchro chưa được cài vào tổ chức này.",
};
// Nhãn ngắn dịch theo ngữ cảnh: khóa trần "Cấp quyền" sẽ đổi mọi nút cùng chữ ở chỗ khác của trang.
const blockBtn = (b: Block) =>
  b === "oauth" ? trc("Cấp quyền", "repo GitHub") : b === "sso" ? tr("Cho phép") : tr("Cài vào tổ chức");

function FixLink({ url, label, onOpen }: { url: string; label: string; onOpen: () => void }) {
  return (
    <a className="btn gh-fix" href={url} target="_blank" rel="noreferrer" onClick={onOpen}>
      {label}<I.External size={13} />
    </a>
  );
}

export function RepoModal({ git, ensureSid, say, onClose, onCloned }: {
  git?: GitState; ensureSid: () => number; say: Say; onClose: () => void; onCloned: (g: GitState) => void;
}) {
  const [st, setSt] = useState<GhStatus | null>(null);
  const [list, setList] = useState<GhRepoPage | null>(null);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<{ msg: string; fix?: GhFix; reconnect?: boolean } | null>(null);
  // Đã mở trang GitHub (gỡ chặn, kết nối): lần cửa sổ được chọn lại thì đọc lại trạng thái và danh sách từ GitHub.
  const away = useRef(false);
  const [nonce, setNonce] = useState(0);
  const fresh = useRef(false);
  const load = () => ghStatus().then(setSt).catch((e) => setErr({ msg: (e as Error).message }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!st?.linked) return;
    const t = setTimeout(() => {
      const refresh = fresh.current;
      fresh.current = false;
      ghRepos(q, 1, refresh).then(setList).catch((e) => setErr({ msg: (e as Error).message }));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [st?.linked, q, nonce]);
  const reload = () => { fresh.current = true; setList(null); setNonce((n) => n + 1); };
  useEffect(() => {
    const back = () => {
      if (!away.current) return;
      away.current = false;
      setErr(null);
      void load();
      reload();
    };
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, []);
  const loadMore = async () => {
    if (!list || more) return;
    setMore(true);
    try {
      const next = await ghRepos(q, list.page + 1);
      setList({ ...next, repos: [...list.repos, ...next.repos] });
    } catch (e) { setErr({ msg: (e as Error).message }); }
    setMore(false);
  };
  const connect = async () => {
    setBusy("connect"); setErr(null);
    const e = await ghConnect();
    setBusy("");
    if (e && e !== "timeout") return setErr({ msg: e });
    if (!e) say("Đã kết nối GitHub");
    // Chưa có tin: người dùng có thể còn đang cấp quyền ở trình duyệt ngoài, lần quay lại sau đọc lại lần nữa.
    else away.current = true;
    // Kết nối lại khi đã kết nối (cấp thêm quyền): token mới nên đọc lại danh sách; lần đầu thì danh sách tự tải.
    // "timeout" (quay lại mà chưa có tin, vd. ứng dụng máy tính kết nối ở trình duyệt ngoài) cũng đọc lại,
    // vì kết nối có thể đã xong ở nơi khác.
    if (st?.linked) reload();
    await load();
  };
  const clone = async (repo: string, branch?: string) => {
    if (!repo.trim()) return;
    setBusy(repo); setErr(null);
    try {
      const g = await gitOp(ensureSid(), "clone", { repo, branch });
      say(`Đã clone ${g.git && g.repo ? g.repo : repo}`);
      onCloned(g);
    } catch (e) {
      const x = e instanceof WsError ? e.extra : {};
      setErr({ msg: (e as Error).message, fix: x.fix, reconnect: x.reconnect });
    }
    setBusy("");
  };
  const has = git?.git && git.repo;
  const missing = list?.missing ?? st?.missing ?? [];
  const login = (st?.login ?? "").toLowerCase();
  const groupOf = (owner: string) => list?.groups.find((g) => g.owner === owner);
  const kindLabel = (g: GhGroup) => g.type === "org" ? trc("Tổ chức", "repo GitHub")
    : g.owner.toLowerCase() === login ? trc("Cá nhân", "repo GitHub") : trc("Cộng tác", "repo GitHub");
  // Tổ chức bị chặn mà không có repo nào hiện ra: liệt kê ở đầu danh sách để thấy ngay cách gỡ chặn.
  const blockedEmpty = (list?.groups ?? []).filter((g) => g.block && g.count === 0);
  const opened = () => { away.current = true; };
  const head = (g: GhGroup) => (
    <div className={`gh-grp${g.block ? " blocked" : ""}`} key={`h-${g.owner}`}>
      <div className="gh-grp-t">
        {g.type === "org" ? <I.Users size={14} /> : <I.User size={14} />}
        <b data-notr>{g.owner}</b><span>{kindLabel(g)}</span>
        {g.count > 0 && <span className="gh-grp-n">{g.count}</span>}
      </div>
      {g.block && (
        <div className="gh-grp-b">
          <I.Lock size={13} /><span>{tr(BLOCK_NOTE[g.block])}</span>
          {g.fixUrl && <FixLink url={g.fixUrl} label={blockBtn(g.block)} onOpen={opened} />}
        </div>
      )}
    </div>
  );
  const rows: React.ReactNode[] = [];
  if (list) {
    for (const g of blockedEmpty) rows.push(head(g));
    let cur = "";
    for (const r of list.repos) {
      const owner = r.owner ?? r.full.split("/")[0];
      if (owner !== cur) {
        cur = owner;
        const g = groupOf(owner);
        if (g) rows.push(head(g));
      }
      rows.push(
        <button key={r.full} className="gh-repo" disabled={!!busy} onClick={() => clone(r.full)}>
          <span className="gh-repo-n">
            <b data-notr>{r.full.slice(owner.length + 1)}</b>{r.private && <em>Riêng tư</em>}
          </span>
          {r.desc && <span className="gh-repo-d" data-notr>{r.desc}</span>}
          {busy === r.full && <span className="gh-repo-s"><span className="ag-spin" />Đang clone…</span>}
        </button>,
      );
    }
  }
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
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
                  await ghUnlink(); setList(null); load(); say("Đã ngắt kết nối GitHub");
                }}>Ngắt kết nối</button>
              </>
              : st.configured ? <>
                <span className="gh-note">Kết nối tài khoản GitHub để clone repo riêng tư và push code.</span>
                <button className="btn dark" disabled={busy === "connect"} onClick={connect}>
                  <I.GitHub size={15} />{busy === "connect" ? "Đang chờ GitHub…" : "Kết nối GitHub"}
                </button>
              </>
              : <span className="gh-note">Máy chủ chưa bật đăng nhập GitHub nên chỉ clone được repo công khai.</span>}
          </div>
          {st?.linked && missing.length > 0 && (
            <div className="gh-scope" role="status">
              <span>{missing.includes("repo")
                ? "Kết nối lại GitHub một lần để Synchro đọc được repo riêng tư và repo của tổ chức."
                : "Kết nối lại GitHub một lần để Synchro thấy repo của mọi tổ chức bạn tham gia."}</span>
              <button className="btn dark" disabled={busy === "connect"} onClick={connect}>
                {busy === "connect" ? "Đang chờ GitHub…" : "Kết nối lại"}
              </button>
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
          {st?.linked && <>
            <div className="gh-search"><I.Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm trong mọi repo bạn truy cập được" />
              <button className="icon-btn" onClick={reload} disabled={!list} aria-label={tr("Tải lại danh sách repo")}
                title={tr("Tải lại danh sách repo")}><I.Retry size={15} /></button>
            </div>
            <div className="gh-list">
              {!list ? <span className="gh-note">Đang tải danh sách repo…</span>
                : !rows.length ? <span className="gh-note">{q ? "Không có repo nào khớp." : "Không có repo nào."}</span>
                : rows}
              {list?.more && (
                <button className="gh-more" onClick={loadMore} disabled={more}>
                  {more ? "Đang tải…" : tf("Xem thêm ({n} repo nữa)", { n: list.total - list.repos.length })}
                </button>
              )}
            </div>
          </>}
        </>}
        {err && (
          <div className="gh-err" role="alert">
            <span>{err.msg}{err.fix && <> <b data-notr>({err.fix.org})</b></>}</span>
            {err.fix && <FixLink url={err.fix.url} label={blockBtn(err.fix.block)} onOpen={opened} />}
            {err.reconnect && !err.fix && <button className="btn dark" onClick={connect}>Kết nối lại</button>}
          </div>
        )}
      </div>
    </div>
  );
}
