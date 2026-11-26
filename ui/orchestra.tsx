"use client";
// Sơ đồ tổ chức của Orchestra trong một lượt trả lời: ai đang giữ vai nào (trưởng nhóm, quản lý, nhân viên, thực tập),
// model nào, đang làm / xong / lỗi, bao nhiêu token; bên dưới là bảng phân công từng nhánh việc. Lúc đang chạy thì mở
// sẵn; câu trả lời xong thì gọn thành một dòng (bấm để xem lại cả nhật ký làm việc của nhóm). Dùng chung cho khung chat
// và kết quả của Autopilot.
import "./styles/orchestra.css";
import { useEffect, useState } from "react";
import * as I from "./icons";
import { Spinner } from "./spinner";
import { tf, tr, trc } from "./i18n";
import {
  ORCH_ROLES, PHASE_LABEL, type OrchMember, type OrchRole, type OrchState, type OrchTaskView,
} from "../shared/orchestra";

const tok = (n: number) =>
  (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
// "≈2.5k token" / "≈2.5k tokens": số nhiều tiếng Anh theo số thật (từ điển ghi hai dạng, tf chọn theo n).
const tokens = (n: number) => tf("≈{k} token", { k: tok(n), n });
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

function Dot({ status, live }: { status: OrchMember["status"] | OrchTaskView["status"]; live: boolean }) {
  const busy = status === "working" || status === "run" || status === "redo";
  if (busy && live) return <Spinner className="orc-spin" />;
  if (status === "done") return <span className="orc-dot ok" aria-hidden="true"><I.Check size={10} /></span>;
  if (status === "failed" || status === "fail") {
    return <span className="orc-dot bad" aria-hidden="true"><I.X size={10} /></span>;
  }
  return <span className={`orc-dot ${status === "skip" ? "skip" : "idle"}`} aria-hidden="true" />;
}
// Nhãn vai và trạng thái: chữ ngắn, dịch theo ngữ cảnh để không đụng nút cùng chữ ở chỗ khác. Gọi trc với chữ viết
// thẳng để bộ kiểm i18n thấy đủ từng khóa.
const ROLE_UI: Record<OrchRole, () => string> = {
  boss: () => trc("Trưởng nhóm", "Orchestra"), manager: () => trc("Quản lý", "Orchestra"),
  staff: () => trc("Nhân viên", "Orchestra"), intern: () => trc("Thực tập", "Orchestra"),
};
const waiting = () => trc("Đang chờ", "Orchestra"), working = () => trc("Đang làm", "Orchestra");
const failed = () => trc("Lỗi", "Orchestra");
const STATUS_UI: Record<OrchMember["status"] | OrchTaskView["status"], () => string> = {
  idle: waiting, working, done: () => trc("Đã xong", "Orchestra"), failed,
  wait: waiting, run: working, redo: () => trc("Đang làm lại", "Orchestra"), fail: failed,
  skip: () => trc("Bỏ qua", "Orchestra"),
};
const role = (r: OrchRole) => ROLE_UI[r]();
const said = (s: OrchMember["status"] | OrchTaskView["status"]) => STATUS_UI[s]();

function Member({ m, live }: { m: OrchMember; live: boolean }) {
  return (
    <div className={`orc-m ${m.role} ${m.status}`} role="listitem"
      aria-label={`${role(m.role)}: ${m.name}, ${said(m.status)}`}>
      <Dot status={m.status} live={live} />
      <span className="orc-m-t">
        <small>{role(m.role)}</small>
        <b data-notr>{m.name}</b>
      </span>
      {m.tokens > 0 && <em data-notr>≈{tok(m.tokens)}</em>}
    </div>
  );
}

function TaskRow({ t, live }: { t: OrchTaskView; live: boolean }) {
  return (
    <div className={`orc-t ${t.status}`} role="listitem">
      <Dot status={t.status} live={live} />
      <div className="orc-t-b">
        <div className="orc-t-h">
          <span className="orc-t-n" data-notr>{t.title}</span>
          {t.redo && <span className="orc-tag">{trc("Đã làm lại", "Orchestra")}</span>}
        </div>
        <div className="orc-t-m">
          <span>{role(t.role)}</span><span data-notr>{t.name}</span>
          {t.tokens > 0 && <span data-notr>{tokens(t.tokens)}</span>}
          {t.ms && t.ms >= 1000 ? <span data-notr>{dur(t.ms)}</span> : null}
          {t.status === "skip" || t.status === "fail" ? <span>{said(t.status)}</span> : null}
        </div>
        {t.note && (t.status === "fail" || t.status === "skip" || t.status === "redo" || t.redo)
          ? <p className="orc-t-note" data-notr>{tr(t.note)}</p> : null}
      </div>
    </div>
  );
}

/**
 * live: lượt đang chạy (mở sẵn, có vòng xoay); xong thì gọn thành một dòng. showDur: hiện tổng thời gian ở dòng đầu
 * (Autopilot); trong khung chat thì không, vì nhật ký làm việc ngay dưới đã ghi thời gian của cả lượt.
 */
export function OrchestraCard({ s, live, showDur }: { s: OrchState; live: boolean; showDur?: boolean }) {
  const [open, setOpen] = useState(live);
  // Lượt vừa xong: thu gọn đúng một lần; người dùng mở lại thì giữ.
  useEffect(() => { if (!live) setOpen(false); }, [live]);
  const total = s.tasks.length, done = s.tasks.filter((t) => t.status === "done").length;
  const models = new Set(s.members.map((m) => m.model)).size;
  // Bản chụp cuối (nhóm xong) tới trước khi lần chạy kết thúc hẳn (còn lưu kết quả, gửi Autopilot): lần chạy còn chạy
  // thì chưa nói "đã xong", tránh dòng đầu của mục Autopilot ghi "Đang chạy" mà thẻ ghi "Nhóm đã xong".
  const ending = live && (s.phase === "done" || s.phase === "failed");
  const phase = ending ? trc("Đang hoàn tất", "Orchestra") : tr(PHASE_LABEL[s.phase]);
  const bits = [
    total ? tf("{done}/{total} việc", { done, total }) : "",
    tf("{n} model cùng làm", { n: models }),
    s.tokens ? tokens(s.tokens) : "",
    showDur && !live && s.ended ? dur(s.ended - s.started) : "",
  ].filter(Boolean);
  const rows = ORCH_ROLES.map((r) => ({ r, list: s.members.filter((m) => m.role === r) })).filter((x) => x.list.length);
  return (
    <section className={`orc ${open ? "open" : ""} ${live ? "live" : ""}`} aria-label="Orchestra">
      <button type="button" className="orc-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="orc-ic">
          {live ? <Spinner className="orc-spin" /> : <I.Users size={14} />}
        </span>
        <b data-notr>Orchestra</b>
        <span className="orc-ph">{phase}</span>
        <span className="orc-meta" data-notr>
          {bits.map((b, k) => (k ? <span key={k} className="orc-more"> · {b}</span> : <span key={k}>{b}</span>))}
        </span>
        <I.ChevronR size={13} />
      </button>
      {open && (
        <div className="orc-b">
          <div className="orc-chart" role="list" aria-label={tr("Sơ đồ nhóm")}>
            {rows.map(({ r, list }) => (
              <div key={r} className={`orc-row ${r}`} role="presentation">
                {list.map((m) => <Member key={`${m.role}-${m.model}`} m={m} live={live} />)}
              </div>
            ))}
          </div>
          {total > 0 && (
            <div className="orc-tasks" role="list" aria-label={tr("Phân công việc")}>
              <div className="orc-tasks-h">{tr("Phân công việc")}</div>
              {s.tasks.map((t) => <TaskRow key={t.id} t={t} live={live} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
export default OrchestraCard;
