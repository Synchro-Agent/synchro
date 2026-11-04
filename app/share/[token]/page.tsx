import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicShare } from "../../sharestore";
import { ShareView } from "../../shareview";

export const dynamic = "force-dynamic";

// Trang công khai của một liên kết chia sẻ: không cần đăng nhập, chỉ đọc. Mọi nội dung lấy từ bản chụp đã lọc (sharesnap.ts).
// noindex + no-referrer: không vào công cụ tìm kiếm, và mã liên kết không lọt sang trang khác qua link trong bài.
type P = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const s = publicShare((await params).token);
  return { title: s ? `${s.snap.title} – Synchro` : "Synchro", robots: { index: false, follow: false }, referrer: "no-referrer", openGraph: null, twitter: null };
}
export default async function SharePage({ params }: P) {
  const token = (await params).token, s = publicShare(token);
  if (!s) notFound();
  return <ShareView snap={s.snap} at={s.at} token={token} />;
}
