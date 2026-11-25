"use client";
// Danh sách trong menu con của một hãng ở bộ chọn model: đội hình ngắn theo bậc (shared/modellineup.ts), mục riêng
// cho model hãng khác đi kèm gói khi có, và "Xem tất cả model" mở thêm các model đời trước cho người cần.
import type { ModelInfo, ProviderInfo } from "../shared/catalog";
import type { Lineup } from "../shared/modellineup";
import { ModelLogo } from "./brands";
import * as I from "./icons";
import { getLang, tr, trc } from "./i18n";
import { resetClock } from "./resetfmt";

type Props = {
  pv: ProviderInfo; lu: Lineup<ModelInfo>; model: string; ok: (k: string) => boolean; pick: (k: string) => void;
  /** all: đang mở "Xem tất cả model"; onAll đổi trạng thái đó mà không đóng menu. */
  all: boolean; onAll: () => void;
};

export function ProviderModels({ pv, lu, model, ok, pick, all, onAll }: Props) {
  const row = (m: ModelInfo) => (
    <button key={m.key} className={`menu-item mline ${ok(m.key) ? "" : "locked"}`} onClick={() => pick(m.key)}
      title={ok(m.key) ? m.id : "Quản trị viên chưa cho phép tài khoản của bạn dùng model này"}>
      <ModelLogo k={m.key} name={m.name} /><span className="mname-t">{m.name}</span>
      {m.isNew && !m.blockedUntil
        ? <span className="mtag mnew" title="Hãng vừa ra mắt, Synchro đã thử và cho dùng">Mới</span> : null}
      {m.blockedUntil
        ? <span className="mtag" title={resetClock(m.blockedUntil, getLang())}>{tr("Hết hạn mức")}</span> : null}
      {m.key === model
        ? <span className="ck"><I.Check /></span>
        : !ok(m.key) && <span className="sc"><I.Lock size={14} /></span>}
    </button>
  );
  return (
    <>
      {lu.main.map(row)}
      {lu.via.length > 0 && (
        <>
          <div className="msub-sec" role="presentation">
            {pv.plan?.cli === "agy" ? trc("Qua Antigravity", "bộ chọn model") : trc("Hãng khác", "bộ chọn model")}
          </div>
          {lu.via.map(row)}
        </>
      )}
      {all && lu.rest.length > 0 && (
        <>
          <div className="msub-sec" role="presentation">{trc("Model khác", "bộ chọn model")}</div>
          {lu.rest.map(row)}
        </>
      )}
      {lu.rest.length > 0 && <hr />}
      {lu.rest.length > 0 && (
        <button className="menu-item mline mall" aria-expanded={all} onClick={onAll}>
          <span className="mname-t">{all ? "Thu gọn" : "Xem tất cả model"}</span>
          <span className="sc">{!all && <span className="mall-n">{lu.rest.length}</span>}<I.Chevron size={14} /></span>
        </button>
      )}
    </>
  );
}
