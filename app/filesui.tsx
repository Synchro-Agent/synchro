"use client";
// Tệp đã tải lên của tài khoản (Cài đặt → Quyền riêng tư): xem dung lượng đã dùng, xóa từng tệp để giải phóng hạn mức hoặc bỏ một tệp nhạy cảm mà không phải xóa tài khoản.
import { useEffect, useState } from "react";
import * as I from "./icons";
import { locale, tr } from "./i18n";

type MyFile = { id: string; name: string; size: number; at: number; kind: string };
const PAGE = 50;
const fmt = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function UploadedFiles({ say, confirm }: { say: (m: string) => void; confirm: (title: string, text: string, ok: string, fn: () => void) => void }) {
  const [d, setD] = useState<{ files: MyFile[]; used: number; quota: number } | null>(null);
  const [err, setErr] = useState("");
  const [shown, setShown] = useState(PAGE);
  const fail = () => tr("Không kết nối được tới máy chủ.");
  const load = () => {
    setErr("");
    fetch("/api/files/mine").then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || fail()); setD(j); }).catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);
  const del = (f: MyFile) => confirm("Xóa tệp này?", "Tệp bị xóa khỏi máy chủ và model không đọc được nữa, kể cả trong các đoạn chat đã gửi tệp. Đoạn chat vẫn còn. Không hoàn tác được.", "Xóa", () => {
    fetch(`/api/files/mine?id=${encodeURIComponent(f.id)}`, { method: "DELETE" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || fail());
      setD((x) => (x ? { ...x, files: x.files.filter((y) => y.id !== f.id), used: Math.max(0, x.used - f.size) } : x));
      say("Đã xóa tệp");
    }).catch((e) => say((e as Error).message));
  });
  if (err) return <div className="empty">{tr(err)} <button className="lnk" onClick={load}>Thử lại</button></div>;
  if (!d) return <div className="empty"><span className="art-spin sm" /></div>;
  return (
    <>
      <p className="d" style={{ margin: "0 0 8px" }}><span data-notr>{fmt(d.used)} / {fmt(d.quota)}</span></p>
      {!d.files.length && <div className="empty">No uploaded files.</div>}
      {d.files.slice(0, shown).map((f) => (
        <div key={f.id} className="item-row sh-row">
          <I.Clip size={14} />
          <span className="sh-row-t">{f.name ? <b style={{ fontWeight: 500 }} data-notr>{f.name}</b> : <b style={{ fontWeight: 500 }}>Tệp không có tên</b>}<em data-notr>{fmt(f.size)} · {new Date(f.at).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}</em></span>
          <a className="icon-btn" href={`/api/files/mine?download=${f.id}`} download aria-label="Tải về" title="Tải về"><I.Download size={14} /></a>
          <button className="btn danger" style={{ height: 26 }} onClick={() => del(f)}>Xóa</button>
        </div>
      ))}
      {d.files.length > shown && <button className="btn" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + PAGE)}>Xem thêm</button>}
    </>
  );
}
