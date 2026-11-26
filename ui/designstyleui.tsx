"use client";
// "Làm theo kiểu này" và "Phong cách của tôi" ở ô soạn tin: bảng chọn (dán liên kết, dùng ảnh đính kèm, phong cách đã
// lưu), chip "Kiểu: …" gắn với đoạn chat, và mục "Lưu làm phong cách của tôi" trong menu Phong cách của artifact. Chip
// giữ theo từng đoạn chat (designchip.ts) và đi kèm mọi lượt gửi của đoạn chat đó (body.designStyle) tới khi bỏ.
// Nạp sau trang chủ (cả CSS): chỉ cần khi mở bảng chọn hoặc khi đoạn chat có chip.
import "./styles/designstyle.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { Menu } from "./ui";
import { Spinner } from "./spinner";
import { getLang, tf, tr, trc } from "./i18n";
import { useApp } from "./store";
import { getBlob } from "./filestate";
import { FLOATING, isAway } from "./clickaway";
import type { DesignChip } from "./designchip";

type PublicStyle = {
  id: string;
  kind: "mine" | "follow";
  name: string;
  source: string;
  host: string | null;
  theme: "light" | "dark";
  swatches: string[];
  fonts: { head: string; body: string };
  image: boolean;
  createdAt: number;
  expiresAt: number | null;
};

/** Chip "Kiểu: <tên> ×" trong dải thẻ của ô soạn tin. */
export function DesignChipCard({ chip, onRemove }: { chip: DesignChip; onRemove: () => void }) {
  return (
    <span className="pick-chip sty-chip">
      <I.Palette size={14} />
      <span className="cv-ell">{trc("Kiểu:", "chip phong cách")} <span data-notr>{chip.name}</span></span>
      <button className="icon-btn" aria-label={tf("Bỏ kiểu {name}", { name: chip.name })} onClick={onRemove}>
        <I.X size={12} />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------- gọi máy chủ
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  type Err = { error?: string; reason?: { key: string; vars: Record<string, string | number> } };
  const j = (await r.json().catch(() => ({}))) as T & Err;
  if (r.ok) return j;
  if (j.reason) throw new Error(`${tr("Không đọc được phong cách")}: ${tf(j.reason.key, j.reason.vars)}.`);
  throw new Error(j.error ? tr(j.error) : tr("Không kết nối được máy chủ."));
}
const b64 = (blob: Blob) => new Promise<string>((ok, bad) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(",")[1] ?? "");
  fr.onerror = () => bad(fr.error ?? new Error("read"));
  fr.readAsDataURL(blob);
});
/** Gửi form bằng Enter / nút gửi mà không tải lại trang. */
const submit = (f: () => unknown) => (e: React.FormEvent) => {
  e.preventDefault();
  void f();
};
/** Tên hiện của phong cách: tên người dùng đặt, không có thì tên trang hay ngày gửi ảnh, theo ngôn ngữ người xem. */
export function styleName(s: Pick<PublicStyle, "name" | "host" | "source" | "createdAt">): string {
  if (s.name) return s.name;
  if (s.host) return s.host;
  if (s.source !== "image") return tr("Phong cách mới");
  const d = new Date(s.createdAt).toLocaleDateString(getLang() === "en" ? "en-GB" : "vi-VN",
    { day: "numeric", month: "numeric" });
  return tf("Ảnh gửi ngày {d}", { d });
}
const daysLeft = (at: number | null) => (at ? Math.max(1, Math.ceil((at - Date.now()) / 86_400_000)) : 0);

const EMPTY = "Chưa có phong cách nào. Lưu từ menu Phong cách của một artifact, hoặc dán liên kết ở trên.";
/** Ô đặt tên phong cách: mở ra là gõ được ngay (con trỏ vào ô), Enter để lưu. */
function NameForm({ className, value, onChange, onSubmit, onCancel, busy = false }: {
  className: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => unknown;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inp.current?.focus();
    inp.current?.select();
  }, []);
  return (
    <form className={className} onSubmit={submit(onSubmit)}>
      <input ref={inp} className="field" value={value} maxLength={60} aria-label="Tên phong cách" disabled={busy}
        onChange={(e) => onChange(e.target.value)} />
      <button type="submit" className="btn dark" disabled={busy}>
        {busy ? <Spinner className="art-spin sm" /> : tr("Lưu")}
      </button>
      {onCancel && <button type="button" className="btn" onClick={onCancel}>{tr("Hủy")}</button>}
    </form>
  );
}
function Swatches({ s }: { s: PublicStyle }) {
  return (
    <span className="sty-sw" aria-hidden="true">
      {s.swatches.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}
    </span>
  );
}

/**
 * Bảng "Làm theo kiểu này": dán liên kết trang mẫu, dùng ảnh chụp đang đính kèm, hoặc chọn một phong cách đã lưu.
 * Chọn xong thì thành chip của đoạn chat (onPick). Bảng gắn vào <body> (vị trí cố định theo nút + là anchor): khối soạn
 * tin có lớp tạo khung chứa riêng, đặt bên trong thì tấm phủ đáy màn hình điện thoại bị lệch và tràn mép phải.
 */
export function DesignStylePop({ open, onClose, onPick, files, brief, say, anchor }: {
  open: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onPick: (c: DesignChip) => void;
  files: string[];
  brief: string;
  say: (m: string) => void;
}) {
  const app = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [list, setList] = useState<PublicStyle[] | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const image = files.find((f) => getBlob(f)?.type.startsWith("image/"));
  // Máy tính: đáy bảng cách đỉnh nút + 8px, mép trái thẳng nút. Dưới 768px: CSS đặt tấm phủ đáy, bỏ vị trí này.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      const wide = matchMedia("(min-width: 768px)").matches;
      setPos(r && wide ? { left: Math.round(r.left), bottom: Math.round(innerHeight - r.top + 8) } : null);
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [open, anchor]);
  const reload = async () => {
    try {
      setList((await api<{ styles: PublicStyle[] }>("/api/design-styles")).styles);
    } catch (e) {
      setList([]);
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (!open) return;
    setErr("");
    setEdit(null);
    void reload();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (isAway(box.current, e.target) && !(e.target as Element | null)?.closest?.(".overlay")) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  const pick = (s: PublicStyle) => {
    const name = styleName(s);
    onPick({ kind: s.kind, id: s.id, name });
    onClose();
    say(tf("Sản phẩm thiết kế tiếp theo sẽ theo kiểu {name}", { name }));
  };
  const read = async (body: Record<string, unknown>, status: string) => {
    setBusy(status);
    setErr("");
    try {
      const j = await api<{ style: PublicStyle }>("/api/design-styles", {
        method: "POST",
        body: JSON.stringify({ ...body, brief }),
      });
      pick(j.style);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const fromUrl = () => {
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) {
      setErr(tr("Hãy dán một liên kết bắt đầu bằng http:// hoặc https://"));
      return;
    }
    let host = u;
    try {
      host = new URL(u).hostname;
    } catch {
      // Liên kết chỉ dùng để hiện tên trang trong dòng trạng thái; máy chủ kiểm tra lại đầy đủ.
    }
    void read({ from: "url", url: u }, tf("Đang đọc phong cách từ trang {host}…", { host }));
  };
  const fromImage = async () => {
    const blob = image ? getBlob(image) : undefined;
    if (!blob) return;
    void read({ from: "image", media_type: blob.type, data: await b64(blob) }, tr("Đang đọc màu từ ảnh…"));
  };
  const rename = async () => {
    if (!edit) return;
    try {
      await api(`/api/design-styles/${edit.id}`, { method: "PATCH", body: JSON.stringify({ name: edit.name }) });
      setEdit(null);
      void reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const keep = async (s: PublicStyle) => {
    try {
      await api(`/api/design-styles/${s.id}`, { method: "PATCH", body: JSON.stringify({ save: true }) });
      say(tf("Đã lưu {name} vào Phong cách của tôi", { name: styleName(s) }));
      void reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = (s: PublicStyle) => app.confirm(tr("Xóa phong cách này?"), tf("{name} sẽ bị xóa cùng ảnh mẫu của nó.",
    { name: styleName(s) }), tr("Xóa"), async () => {
    try {
      await api(`/api/design-styles/${s.id}`, { method: "DELETE" });
      void reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  });
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={box} className="sty-anchor" {...{ [FLOATING]: "" }}>
      <Menu open={open} role="dialog" className="sty-pop" style={pos ?? undefined}>
        <div className="sty-head">
          <b>{tr("Làm theo kiểu này")}</b>
          <button className="icon-btn" aria-label="Đóng" onClick={onClose}><I.X size={16} /></button>
        </div>
        <p className="sty-note">
          {tr("Synchro chỉ học màu, chữ và nhịp bố cục của mẫu, không chép logo, chữ hay ảnh của trang đó.")}
        </p>
        <form className="sty-url" onSubmit={submit(fromUrl)}>
          <I.Globe size={16} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url"
            aria-label="Liên kết trang bạn thích" disabled={!!busy} />
          <button type="submit" className="btn dark" disabled={!!busy || !url.trim()}>
            {trc("Đọc", "liên kết phong cách")}
          </button>
        </form>
        <button className="menu-item sty-img" disabled={!image || !!busy} onClick={() => void fromImage()}>
          <I.Image />
          <span className="sty-t">
            <b>{tr("Dùng ảnh đính kèm")}</b>
            <em>{image ? <span data-notr>{image}</span> : tr("Đính kèm trước ảnh chụp trang bạn thích")}</em>
          </span>
        </button>
        {busy && <div className="sty-busy" role="status"><Spinner className="art-spin sm" />{busy}</div>}
        {err && <div className="sty-err" role="alert">{tr(err)}</div>}
        <div className="sty-sec">{tr("Phong cách của tôi")}</div>
        <div className="sty-list">
          {list === null ? <div className="cm-empty"><Spinner className="art-spin sm" /></div>
            : !list.length ? <div className="sty-empty">{tr(EMPTY)}</div>
              : list.map((s) => (
                <div key={s.id} className="sty-row">
                  {edit?.id === s.id ? (
                    <NameForm className="sty-rename" value={edit.name} onChange={(name) => setEdit({ id: s.id, name })}
                      onSubmit={rename} onCancel={() => setEdit(null)} />
                  ) : (
                    <>
                      <button className="sty-use" onClick={() => pick(s)} disabled={!!busy}>
                        <Swatches s={s} />
                        <span className="sty-t">
                          <b data-notr>{styleName(s)}</b>
                          <em>
                            <span data-notr>{[s.fonts.head, s.fonts.body].filter(Boolean).join(" · ")}</span>
                            {s.kind === "follow" && <> · {tf("còn {n} ngày", { n: daysLeft(s.expiresAt) })}</>}
                          </em>
                        </span>
                      </button>
                      {s.kind === "follow" && (
                        <button className="btn sty-keep" onClick={() => void keep(s)}>{tr("Lưu")}</button>
                      )}
                      <button className="icon-btn" aria-label={tf("Đổi tên {name}", { name: styleName(s) })}
                        onClick={() => setEdit({ id: s.id, name: styleName(s) })}><I.Pencil size={15} /></button>
                      <button className="icon-btn" aria-label={tf("Xóa {name}", { name: styleName(s) })}
                        onClick={() => remove(s)}><I.Trash size={15} /></button>
                    </>
                  )}
                </div>
              ))}
        </div>
      </Menu>
    </div>,
    document.body,
  );
}

/**
 * Mục cuối menu Phong cách của artifact: lưu phong cách đang hiện (bản trộn của sản phẩm, hoặc phong cách vừa thử)
 * thành "Phong cách của tôi" để dùng lại cho sản phẩm sau.
 */
export function SaveStyleItem({ conv, ident, title, content, preset, say }: {
  conv: string;
  ident: string;
  title: string;
  content: string;
  preset: string;
  say: (m: string) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveIt = async () => {
    setBusy(true);
    try {
      const body = { from: "artifact", conv, ident, content, preset, name: name?.trim() || title, save: true };
      const j = await api<{ style: PublicStyle }>("/api/design-styles", { method: "POST", body: JSON.stringify(body) });
      say(tf("Đã lưu {name} vào Phong cách của tôi", { name: styleName(j.style) }));
      setName(null);
    } catch (e) {
      say(tr((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  if (name === null) {
    return (
      <button className="menu-item sty-save" onClick={() => setName(title)}>
        <I.FolderPlus size={16} /><span className="art-dl-t"><b>{tr("Lưu làm phong cách của tôi")}</b></span>
      </button>
    );
  }
  return (
    <NameForm className="sty-savef" value={name} onChange={setName} onSubmit={saveIt} busy={busy} />
  );
}
