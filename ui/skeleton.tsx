"use client";
import { tr } from "../app/i18n";
// Khung chờ đúng kích thước thật: dòng đoạn chat, tin nhắn, khung artifact, trang cài đặt. Mỗi khung chờ dùng chung luật CSS với phần thật
// (.sk-chat đi cùng .chat-item, .sk-user cùng .user-msg, .sk-art cùng .art-panel…; trang cài đặt dùng thẳng .row / h3), chữ giả là khoảng trắng
// có chiều cao dòng thật nên khi nội dung về, không có gì bị đẩy đi (đo bằng tests/ui/skeletons.mjs). Tên lớp riêng (không dùng .chat-item,
// .user-msg, .art-panel) để mã và bài kiểm thử tìm phần tử thật không bắt nhầm khung chờ.

/** Chữ giả: khoảng trắng em, nền ánh nhẹ; chiều cao lấy từ dòng chữ thật của phần tử cha. */
export const SkText = ({ w }: { w: number }) => <span className="sk-txt" aria-hidden>{" ".repeat(w)}</span>;

// Độ dài chữ giả cố định (không ngẫu nhiên): khung chờ không nhảy giữa các lần vẽ.
const ROW_W = [11, 8, 13, 9, 12, 7, 10, 12, 8, 11];

/** Dòng đoạn chat ở thanh bên khi danh sách đang về từ máy chủ (thiết bị mới, trình duyệt chưa có gì). */
export function ChatListSkeleton({ n = 8 }: { n?: number }) {
  return <div className="sk-list" role="status" aria-label={tr("Đang tải danh sách đoạn chat")}>{Array.from({ length: n }, (_, i) => <div key={i} className="sk-chat"><SkText w={ROW_W[i % ROW_W.length]} /></div>)}</div>;
}

/** Tin nhắn khi đoạn chat đang tải từ máy chủ: hai lượt hỏi đáp, đặt thẳng vào cột tin nhắn (.thread-in) để khoảng cách giữa các lượt là của cột thật. */
export function ThreadSkeleton() {
  // Dòng câu trả lời theo % bề rộng cột (không xuống dòng lung tung ở màn hẹp), mỗi dòng cao đúng một dòng chữ thật.
  const ai = (k: number, lines: number[]) => <div key={k} className="sk-ai" aria-hidden><p>{lines.map((w, i) => <span key={i} className="sk-line" style={{ width: `${w}%` }}>{"\u2003"}</span>)}</p></div>;
  const user = (k: number, w: number) => <div key={k} className="sk-uwrap" aria-hidden><div className="sk-user"><SkText w={w} /></div></div>;
  return <>{user(0, 14)}{ai(1, [96, 88, 58])}{user(2, 9)}{ai(3, [94, 70])}</>;
}

/** Khung artifact / tệp đang tải phần mã của nó: cùng vị trí, bề rộng, thanh tiêu đề như khung thật (tên đã biết thì hiện luôn). */
export function ArtPanelSkeleton({ title, sub, tabs, expanded, acts = 4 }: { title?: string; sub?: string; tabs?: boolean; expanded?: boolean; acts?: number }) {
  return (
    <aside className={`sk-art${expanded ? " full" : ""}`} role="status" aria-busy aria-label={title ?? tr("Đang mở")}>
      <header className="sk-art-head">
        <span className="sk-blk sk-ic" />
        <div className="art-head-t">{title ? <b data-notr>{title}</b> : <b><SkText w={9} /></b>}<span>{sub ?? <SkText w={5} />}</span></div>
        {tabs && <div className="art-tabs" aria-hidden><span className="sk-tab"><SkText w={4} /></span><span className="sk-tab"><SkText w={2} /></span></div>}
        <div className="art-acts" aria-hidden>{Array.from({ length: acts }, (_, i) => <span key={i} className="sk-blk sk-act" />)}</div>
      </header>
      <div className="art-body sk-art-body"><div className="sk-sheen" /></div>
    </aside>
  );
}

/** Trang cài đặt đang tải: tiêu đề mục và các hàng cùng lớp .row thật. Ba hàng đầu theo đúng trang mở mặc định (Chung: Giao diện — hàng
 *  không mô tả với nhóm nút 112×34, hàng không mô tả với ô chọn 97×32, hàng có một dòng mô tả); các mục sau là hàng mô tả + công tắc.
 *  Màn hẹp: nút điều khiển xuống dòng dưới chữ như hàng thật. Trả về các phần tử liền nhau (không bọc) để luật "mục đầu tiên sau tiêu đề
 *  trang" và "hàng liền hàng" của trang cài đặt áp đúng như trang thật. */
const SET_ROWS: [number, number | null, number, number][] = [[5, null, 112, 34], [9, null, 97, 32], [7, 16, 195, 34], [10, 18, 44, 24]];
export function SettingsSkeleton({ rows = 4, groups = 2 }: { rows?: number; groups?: number }) {
  return (
    <>
      {Array.from({ length: groups }, (_, g) => [
        <h3 key={`h${g}`} className={`sk-h${g ? " sec" : ""}`} aria-hidden><SkText w={g ? 6 : 8} /></h3>,
        ...Array.from({ length: g ? Math.max(2, rows - 1) : rows }, (_, i) => {
          const [tw, dw, cw, ch] = g ? [ROW_W[(i + 3) % ROW_W.length] - 2, ROW_W[(i + 7) % ROW_W.length] + 6, 44, 24] : SET_ROWS[Math.min(i, SET_ROWS.length - 1)];
          return (
            <div key={`${g}-${i}`} className="row sk-srow" aria-hidden>
              <div><div className="t"><SkText w={tw} /></div>{dw && <div className="d"><SkText w={dw} /></div>}</div>
              <span className="sk-blk sk-ctl" style={{ width: cw, height: ch }} />
            </div>
          );
        }),
      ])}
      <span className="sr-only" role="status">{tr("Đang tải")}</span>
    </>
  );
}

/** Màn hình chờ lúc mở app (chưa biết phiên đăng nhập): thanh trái, thanh bên có ô tìm và các dòng đoạn chat, lời chào và ô soạn tin, đúng
 *  vị trí của app thật đo ở máy tính lẫn điện thoại (tests/ui/skeletons.mjs so từng khung). Mở thẳng một đoạn chat (#c=…) thì vùng chính là tin nhắn. */
export function BootSkeleton({ chat }: { chat?: boolean }) {
  return (
    <>
      <div className="boot-rail"><span className="sk-blk boot-mark" />{Array.from({ length: 7 }, (_, i) => <span key={i} className="boot-nav"><span className="sk-blk" /><span className="sk-blk" /></span>)}<span className="sk-blk boot-me" /></div>
      <div className="boot-side">
        <div className="boot-panel">
          <span className="sk-blk boot-logo" />
          <span className="sk-blk boot-search" />
          <div className="boot-sec"><SkText w={8} /></div>
          <div className="boot-rows">{Array.from({ length: 12 }, (_, i) => <div key={i} className="sk-chat"><SkText w={ROW_W[i % ROW_W.length]} /></div>)}</div>
        </div>
      </div>
      <div className="boot-main">
        <div className="boot-top" />
        {/* Có cả hai dạng: HTML dựng ở máy chủ (A3) có trước khi trang chạy mã, mà máy chủ không thấy #c=. Lệnh nhỏ trong <head> (layout.tsx)
            đặt data-boot-chat trên <html> trước khi vẽ, CSS chỉ hiện dạng tin nhắn; trang chạy rồi thì chat (bootChat) quyết định. */}
        <div className={`boot-thread boot-v-chat${chat ? " on" : ""}`}><div className="sk-thread-in"><ThreadSkeleton /></div></div>
        {!chat && (
          <div className="boot-hero boot-v-home"><div className="boot-col">
            <div className="boot-date"><SkText w={9} /></div>
            <div className="boot-greet"><SkText w={11} /></div>
            <div className="boot-box" />
          </div></div>
        )}
        <div className={`boot-dock boot-v-chat${chat ? " on" : ""}`}><div className="boot-box" /></div>
      </div>
    </>
  );
}
