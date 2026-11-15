import { handle, requireUser } from "../../../../server/authstore";
import { usageDetails } from "../../../../server/usage";
import { planModelName, planTurns, SUB } from "../../../../server/ai/subs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VENDOR = { claude: "anthropic", codex: "openai", agy: "google", grok: "xai" } as const;

// Chi tiết 30 ngày cho Cài đặt → Usage (?tz= độ lệch múi giờ của trình duyệt, phút): khóa API theo chi phí và token,
// gói subscription theo số lượt (hãng không báo token của gói), gộp chung theo ngày và theo hãng.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const { dayOf, ...d } = usageDetails(user.id, Number(new URL(req.url).searchParams.get("tz")) || 0);
  const turns = planTurns(user.id, Date.now() - 30 * 86_400_000);
  const byPlan = new Map<string, { model: string; cli: string; name: string; turns: number; last: number }>();
  for (const t of turns) {
    const k = dayOf(t.at), v = VENDOR[t.cli];
    if (k >= 0 && k < 30) d.days[k].calls[v] = (d.days[k].calls[v] ?? 0) + 1;
    const key = t.model || `sub-${t.cli}/`;
    const row = byPlan.get(key) ?? { model: key, cli: t.cli, name: (t.model && planModelName(user.id, t.model)) || `${SUB[t.cli].name}`, turns: 0, last: 0 };
    row.turns++; row.last = Math.max(row.last, t.at);
    byPlan.set(key, row);
  }
  return Response.json({ ...d, byPlan: [...byPlan.values()].sort((a, b) => b.turns - a.turns) }, { headers: { "cache-control": "no-store" } });
});
