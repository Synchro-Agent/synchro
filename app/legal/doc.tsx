// Khung chung cho các trang pháp lý công khai (/privacy, /terms).
import Link from "next/link";
import { Lockup } from "../brand";

export function LegalDoc({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="legal">
      <Link href="/" className="legal-brand brand-lock" aria-label="Synchro"><Lockup height={20} className="lk-hover" /></Link>
      <h1>{title}</h1>
      <p className="legal-upd">Cập nhật lần cuối: {updated}</p>
      {children}
      <nav className="legal-nav"><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản sử dụng</Link><Link href="/">Về trang chủ</Link></nav>
    </main>
  );
}
