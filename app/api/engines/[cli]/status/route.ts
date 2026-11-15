import { status } from "../../../../../server/ai/cli_auth";
import { agySetupPending, apiEquivalent, apiOptIn, planBlock } from "../../../../../server/ai/subs";
import { engineRoute, noStore } from "../../../../../server/routes/engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trạng thái CLI của chính tài khoản: đã cài chưa, phiên bản, đã đăng nhập chưa và bằng cách nào, lượt đăng nhập đang chờ (nếu có). ?fresh=1 bỏ qua bộ nhớ 60 giây.
// blockedUntil: gói đang hết hạn mức tới lúc nào; usingApiUntil: người dùng đã đồng ý dùng khóa API thay gói tới lúc nào;
// apiModel: model API cùng hãng người dùng được dùng (để đề nghị khi gói hết hạn mức), hoặc null;
// setup: Antigravity đang chờ người dùng hoàn tất bước làm quen lần đầu.
export const GET = engineRoute(async (req, user, cli) => {
  const s = await status(cli, user.id, { fresh: new URL(req.url).searchParams.get("fresh") === "1" });
  return Response.json({ ...s, blockedUntil: planBlock(cli, user.id), usingApiUntil: apiOptIn(user.id, cli), apiModel: await apiEquivalent(user, `sub-${cli}/default`), setup: cli === "agy" && agySetupPending(user.id) }, noStore);
});
