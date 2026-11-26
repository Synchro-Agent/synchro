"use client";
// Danh sách trong menu con của một hãng ở bộ chọn model: đội hình ngắn theo bậc (shared/modellineup.ts), mục riêng
// cho model hãng khác đi kèm gói khi có, và "Xem tất cả model" mở thêm các model đời trước cho người cần.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo, ProviderInfo } from "../shared/catalog";
import { lineup, realVendor, type Lineup, type LineupOpts } from "../shared/modellineup";
import { ModelLogo } from "./brands";
import * as I from "./icons";
import { getLang, tr, trc } from "./i18n";
import { resetClock } from "./resetfmt";

type Props = {
  pv: ProviderInfo; lu: Lineup<ModelInfo>; model: string; ok: (k: string) => boolean; pick: (k: string) => void;
  /** all: đang mở "Xem tất cả model". */
  all: boolean;
};
// Gói ghi kèm "(Antigravity)" sau tên model hãng khác để phân biệt trong danh sách đầy đủ; dưới tiêu đề
// "Qua Antigravity" thì chữ đó chỉ lặp lại.
const VIA_TAIL = /\s*\(Antigravity\)\s*$/i;

export function ProviderModels({ pv, lu, model, ok, pick, all }: Props) {
  /** via: dòng trong mục model hãng khác: logo theo hãng thật của model (Claude, không phải logo của gói). */
  const row = (m: ModelInfo, via = false) => (
    <button key={m.key} className={`menu-item mline ${ok(m.key) ? "" : "locked"}`} onClick={() => pick(m.key)}
      title={ok(m.key) ? m.id : "Quản trị viên chưa cho phép tài khoản của bạn dùng model này"}>
      {/* Mã không kèm tên nhà cung cấp: logo lấy theo dòng model (claude-… → Claude) thay vì theo gói. */}
      {via && realVendor(m.id) ? <ModelLogo k={m.id} name={m.name} /> : <ModelLogo k={m.key} name={m.name} />}
      <span className="mname-t">{via ? m.name.replace(VIA_TAIL, "") : m.name}</span>
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
      {lu.main.map((m) => row(m))}
      {lu.via.length > 0 && (
        <>
          <div className="msub-sec" role="presentation">
            {pv.plan?.cli === "agy" ? trc("Qua Antigravity", "bộ chọn model") : trc("Hãng khác", "bộ chọn model")}
          </div>
          {lu.via.map((m) => row(m, true))}
        </>
      )}
      {all && lu.rest.length > 0 && (
        <>
          <div className="msub-sec" role="presentation">{trc("Model khác", "bộ chọn model")}</div>
          {lu.rest.map((m) => row(m))}
        </>
      )}
    </>
  );
}

/**
 * Nút "Xem tất cả model" / "Thu gọn": nằm ngoài vùng cuộn, ở đáy menu con, nên danh sách mở rộng dài đến đâu
 * nút vẫn thấy được. onAll đổi trạng thái mà không đóng menu.
 */
export function AllToggle({ lu, all, onAll }: { lu: Lineup<ModelInfo>; all: boolean; onAll: () => void }) {
  if (!lu.rest.length) return null;
  return (
    <div className="mall-foot">
      <hr />
      <button className="menu-item mline mall" aria-expanded={all} onClick={onAll}>
        <span className="mname-t">{all ? "Thu gọn" : "Xem tất cả model"}</span>
        <span className="sc">{!all && <span className="mall-n">{lu.rest.length}</span>}<I.Chevron size={14} /></span>
      </button>
    </div>
  );
}

// Phần cuộn của danh sách model nằm trong khung kính chứ không phải chính khung kính: nền và viền kính là lớp
// ::before / ::after của khung, khung tự cuộn thì chúng trôi theo nội dung (viền cắt ngang dòng cuối, các dòng lòi ra
// ngoài nền). Ghi chú gói đứng yên ở đầu khung.
// more: còn dòng ở dưới chưa thấy: đáy vùng cuộn mờ dần để báo còn nữa (khung kính không có thanh cuộn hiện sẵn).
type MsubProps = {
  on: boolean; count: number; tall?: boolean; children: React.ReactNode;
  place: (scroller: HTMLElement, tall: boolean) => void;
};
function MsubBody({ on, count, tall = false, place, children }: MsubProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = () => {
    const el = ref.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (on && ref.current) place(ref.current, tall); }, [on, count, tall]);
  // Sau khi khung đã đặt chỗ và đổi cao (placeSub đổi maxHeight ở lượt vẽ sau) mới đo được còn dòng ẩn hay không.
  useEffect(() => {
    if (!on) return;
    const raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  });
  return <div ref={ref} className={`menu-scroll msub-scroll${more ? " more" : ""}`} onScroll={check}>{children}</div>;
}

/**
 * Thân menu con của một hãng: tính đội hình rồi vẽ danh sách cuộn và nút "Xem tất cả model". Nằm ở tệp này (tải
 * chậm cùng shared/modellineup.ts) để quy tắc đội hình không vào phần tải đầu của trang chat.
 * place: bộ chọn model đặt chỗ và chiều cao khung theo số dòng đang hiện.
 */
export function ProviderSub({ pv, on, place, opts, all, onAll, ...rest }: Omit<Props, "lu"> & {
  on: boolean; place: MsubProps["place"]; opts: LineupOpts; onAll: () => void;
}) {
  const { selected, code, ownPlans, kind, ok } = opts;
  const lu = useMemo(() => lineup(pv.models, { selected, code, ownPlans, kind, ok }),
    [pv.models, selected, code, ownPlans, kind, ok]);
  const count = lu.main.length + lu.via.length + (all ? lu.rest.length : 0);
  return (
    <>
      <MsubBody on={on} count={count} tall={all} place={place}>
        <ProviderModels pv={pv} lu={lu} all={all} {...rest} />
      </MsubBody>
      <AllToggle lu={lu} all={all} onAll={onAll} />
    </>
  );
}
