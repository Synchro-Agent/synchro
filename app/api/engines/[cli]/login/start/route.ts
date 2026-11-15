import { limit } from "../../../../../../server/authstore";
import { cancelLogin, type Method, startLogin } from "../../../../../../server/ai/cli_auth";
import { engineRoute, noStore } from "../../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bắt đầu đăng nhập: chạy lệnh đăng nhập của CLI, trả link (và mã một lần với codex) để hiện trên giao diện.
// Claude nhận { method: "token" (setup-token, mặc định) | "oauth" (auth login) }.
export const POST = engineRoute(async (req, user, cli) => {
  limit(`engine-login:${user.id}`, 10, 10 * 60_000);
  const b = (await req.json().catch(() => ({}))) as { method?: string };
  const method: Method = cli === "claude" && b.method === "oauth" ? "oauth" : null;
  return Response.json(await startLogin(cli, user.id, method), noStore);
});

// Hủy lượt đăng nhập đang chờ (dừng tiến trình CLI).
export const DELETE = engineRoute(async (_req, user, cli) => {
  cancelLogin(cli, user.id);
  return Response.json({ ok: true }, noStore);
});
