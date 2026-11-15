"use client";
// Phần riêng của thẻ duyệt khi lời gọi đi qua Composio: nói bằng thao tác thật (ứng dụng, tài khoản, thao tác, tham số chính) thay cho tên công cụ bọc ngoài.
// Dùng chung cho thẻ trong nhật ký làm việc (agentui.tsx) và thẻ chờ duyệt của lượt chat (connectorsui.tsx).
import { tr, trCx } from "../app/i18n";
import { appName, type CxCard, type CxWrite } from "../shared/cxactions";

/** "Google Docs · Tạo tài liệu 'Synchro test'": tên thao tác theo ngôn ngữ giao diện, tên ứng dụng và tham số giữ nguyên. */
export const cxHead = (cx: CxCard) => `${cx.name} · ${trCx(cx.act)}${cx.main ? ` '${cx.main}'` : ""}`;
/** Một dòng cho mỗi thao tác ghi: "Gmail · Gửi email 'Xin chào'". */
const writeHead = (w: CxWrite) => `${w.name} · ${trCx(w.act)}${w.main ? ` '${w.main}'` : ""}`;

/** Tài khoản, tham số chính, số thao tác khác trong cùng lời gọi, và phạm vi của quyền sẽ cấp. */
export function CxDetails({ cx }: { cx: CxCard }) {
  return (
    <div className="cxa-card">
      {cx.writes?.length
        ? cx.writes.map((w, i) => (
            <div key={i} className="cxa-w">
              <b data-notr>{writeHead(w)}</b>
              {w.account && <span data-notr>{w.account}</span>}
            </div>
          ))
        : <>
            {cx.account && <div className="cxa-row"><span>{tr("Tài khoản")}</span><b data-notr>{cx.account}</b></div>}
            {cx.params?.map(([k, v]) => <div key={k} className="cxa-row"><span data-notr>{k}</span><b data-notr>{v}</b></div>)}
          </>}
      {cx.more ? <div className="cxa-note">{`+${cx.more} ${tr("thao tác khác trong cùng lời gọi")}`}</div> : null}
      {cx.strict
        ? <div className="cxa-note">{tr("Việc này chạy lệnh hoặc gọi API tùy ý nên Synchro luôn hỏi trước mỗi lần.")}</div>
        : cx.apps?.length ? <div className="cxa-note">{tr("Quyền bạn chọn chỉ áp dụng cho thao tác thay đổi dữ liệu trong")} <b data-notr>{cx.apps.map(appName).join(", ")}</b></div> : null}
    </div>
  );
}
