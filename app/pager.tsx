"use client";
// Phân trang dùng chung cho mọi danh sách dài (người dùng, nhật ký, hạn mức, giá model, artifact, hộp thư, lịch sử…): "1–10 / 50" và
// hai nút ‹ › tròn, cùng kiểu với danh sách tài khoản ở Quản trị. compact: bản gọn cho chỗ hẹp (thanh bên).
// usePage(list, per, reset): trang hiện tại, các mục của trang, tự về trang 1 khi reset đổi (vd. đổi bộ lọc / từ khóa tìm).
import { useEffect, useState } from "react";
import * as I from "./icons";

export type Paged<T> = { items: T[]; page: number; pages: number; from: number; to: number; total: number; setPage: (n: number) => void };

export function usePage<T>(list: T[], per: number, reset?: unknown): Paged<T> {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [reset]);
  const pages = Math.max(1, Math.ceil(list.length / per)), p = Math.min(page, pages);
  return { items: list.slice((p - 1) * per, p * per), page: p, pages, from: list.length ? (p - 1) * per + 1 : 0, to: Math.min(p * per, list.length), total: list.length, setPage };
}

export function Pager({ page, pages, from, to, total, more, plus, onPage, compact }: { page: number; pages: number; from: number; to: number; total: number; more?: boolean; plus?: boolean; onPage: (n: number) => void; compact?: boolean }) {
  if (pages <= 1 && !more) return null;
  return (
    <div className={`adm-pager${compact ? " compact" : ""}`}>
      <span className="adm-pg-n" data-notr><b>{from}–{to}</b> / {total}{plus ? "+" : ""}</span>
      <span className="adm-pg-b">
        <button className="icon-btn" disabled={page <= 1} aria-label="Previous page" onClick={() => onPage(page - 1)}><I.ChevronL size={15} /></button>
        {!compact && <span className="adm-pg" data-notr>{page} / {pages}{plus ? "+" : ""}</span>}
        <button className="icon-btn" disabled={page >= pages && !more} aria-label="Next page" onClick={() => onPage(page + 1)}><I.ChevronR size={15} /></button>
      </span>
    </div>
  );
}

/** Thanh phân trang cho một danh sách đã usePage. */
export function PageBar<T>({ pg, compact }: { pg: Paged<T>; compact?: boolean }) {
  return <Pager page={pg.page} pages={pg.pages} from={pg.from} to={pg.to} total={pg.total} onPage={pg.setPage} compact={compact} />;
}
