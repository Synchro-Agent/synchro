// Trang chủ (server component, blueprint A3): đọc cookie phiên synchro_session, dựng sẵn gói khởi động (tài khoản, danh sách model, khả năng,
// studio, số mục Hộp thư) ở máy chủ rồi truyền vào <Home boot>. Trang không còn hai tầng chờ (auth/me rồi bảy lệnh song song) trước khi dùng được.
// Thân trang (client component) nằm ở app/home.tsx.
import { cookies } from "next/headers";
import { COOKIE } from "./authstore";
import { bootFor, type BootData } from "./bootdata";
import Home from "./home";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const jar = await cookies();
  const sid = jar.get(COOKIE)?.value;
  let boot: BootData | null = null;
  // Không cookie: màn đăng nhập, Home tự hỏi /api/auth/me như trước (không dựng gì ở máy chủ). Lỗi dựng gói: Home cũng tự hỏi lại, không sập trang.
  if (sid) {
    try { boot = await bootFor(new Request("http://synchro.local/", { headers: { cookie: `${COOKIE}=${sid}` } })); } catch (e) { console.error("[page boot]", e); }
  }
  return <Home boot={boot} />;
}
