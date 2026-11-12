"use client";
// Phần riêng của thẻ duyệt khi lời gọi đi qua Composio: nói bằng thao tác thật (ứng dụng, tài khoản, thao tác, tham số chính) thay cho tên công cụ bọc ngoài.
// Dùng chung cho thẻ trong nhật ký làm việc (agentui.tsx) và thẻ chờ duyệt của lượt chat (connectorsui.tsx).
import { tr } from "./i18n";
import { appName, type CxCard } from "./cxactions";

/** "Google Docs · Tạo tài liệu 'Synchro test'": tên thao tác theo ngôn ngữ giao diện, tên ứng dụng và tham số giữ nguyên. */
export const cxHead = (cx: CxCard) => `${cx.name} · ${tr(cx.act)}${cx.main ? ` '${cx.main}'` : ""}`;

/** Tài khoản, tham số chính, số thao tác khác trong cùng lời gọi, và phạm vi của quyền sẽ cấp. */
export function CxDetails({ cx }: { cx: CxCard }) {
  return (
    <div className="cx-d">
      {cx.account && <div className="cx-row"><span>{tr("Tài khoản")}</span><b data-notr>{cx.account}</b></div>}
      {cx.params?.map(([k, v]) => <div key={k} className="cx-row"><span data-notr>{k}</span><b data-notr>{v}</b></div>)}
      {cx.more ? <div className="cx-note">{`+${cx.more} ${tr("thao tác khác trong cùng lời gọi")}`}</div> : null}
      {cx.strict
        ? <div className="cx-note">{tr("Việc này chạy lệnh hoặc gọi API tùy ý nên Synchro luôn hỏi trước mỗi lần.")}</div>
        : cx.apps?.length ? <div className="cx-note">{tr("Quyền bạn chọn chỉ áp dụng cho thao tác thay đổi dữ liệu trong")} <b data-notr>{cx.apps.map(appName).join(", ")}</b></div> : null}
    </div>
  );
}
