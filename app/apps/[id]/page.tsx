import { AppRunner } from "../../../ui/appsui";

// Trang chạy một ứng dụng nội bộ (artifact đã xuất bản): toàn màn hình, có kho dữ liệu và gọi được AI theo quyền người dùng.
export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppRunner id={id} />;
}
