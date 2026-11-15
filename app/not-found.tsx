import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "../ui/brand";
import { LangSwitch } from "../ui/langswitch";

// Trang 404 theo giao diện và ngôn ngữ người dùng đã chọn (layout đặt giao diện, I18n dịch chữ); luôn có đường về.
export const metadata: Metadata = { title: "Không tìm thấy trang – Synchro" };

export default function NotFound() {
  return (
    <main className="err-page">
      <LangSwitch />
      <Mark size={30} />
      <h1>Không tìm thấy trang này</h1>
      <p>Địa chỉ có thể đã gõ sai, hoặc trang đã được chuyển đi nơi khác.</p>
      <div className="err-acts"><Link className="btn dark" href="/">Về trang chủ</Link></div>
    </main>
  );
}
