import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { tierOf, vendorOf, type Tier } from "../../router";
import { mergeFindings, numbered, parseFindings, type Finding } from "../../critic";
import { OneShotErr, oneShot, usableModels } from "../../ai/anymodel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hội đồng phản biện: 1–2 model của hãng khác với model vừa viết sản phẩm (nhìn bằng "mắt khác" thì bắt lỗi tốt hơn),
// chạy song song, trả về lỗi theo dòng dạng JSON; ý kiến trùng chỗ được gộp lại. Model lấy từ đúng các model người dùng
// dùng được (gói subscription hoặc khóa API), hãng tính theo nhà làm model nên "sub-claude/opus" và "anthropic/…" cùng một hãng.
const CRITIC = `<critic_review>
Bạn là một thành viên hội đồng phản biện, đọc lại sản phẩm một model khác vừa viết (code, trang web hoặc ứng dụng React) để tìm lỗi thật trước khi người dùng dùng.
Chỉ nêu vấn đề đáng sửa: chạy sai hoặc hỏng, lỗ hổng bảo mật, mất dữ liệu, không dùng được trên điện thoại hoặc bằng bàn phím và trình đọc màn hình, hiệu năng tệ rõ rệt. Không nêu ý kiến về phong cách, cách đặt tên hay sở thích. Không có vấn đề thì trả về danh sách rỗng.
Trả về DUY NHẤT một JSON: {"findings":[{"line_start":số,"line_end":số,"severity":"high"|"medium"|"low","title":"tiêu đề ngắn","detail":"vì sao sai và hậu quả, 1–2 câu","suggested_fix":"nội dung mới thay cho đúng các dòng line_start..line_end"}]}
- Số dòng theo cột số bên trái; suggested_fix thay trọn các dòng đó, giữ thụt lề, không kèm số dòng, sửa tối thiểu.
- Tối đa 6 mục, nặng nhất trước. Viết tiêu đề và giải thích bằng ngôn ngữ của người dùng (mặc định tiếng Việt).
</critic_review>`;
const MAX = 2;
const LABEL: Record<string, string> = { code: "code", html: "trang web HTML", react: "ứng dụng React" };

// Mỗi hãng một model: ưu tiên hạng cân bằng (đủ giỏi, rẻ hơn hạng mạnh nhất).
function pickCritics(allowed: string[], exclude: string, avoid: string): string[] {
  const byProv = new Map<string, string[]>();
  for (const k of allowed) { const p = vendorOf(k); byProv.set(p, [...(byProv.get(p) ?? []), k]); }
  const best = (ks: string[]) => (["balanced", "strong", "fast"] as Tier[]).map((t) => ks.find((k) => tierOf(k) === t && k !== avoid)).find(Boolean) ?? ks.find((k) => k !== avoid) ?? ks[0];
  const others = [...byProv.entries()].filter(([p]) => p !== exclude).map(([, ks]) => best(ks));
  if (others.length) return others.slice(0, MAX);
  // Chỉ có một hãng: dùng model khác model vừa viết nếu có.
  const own = byProv.get(exclude) ?? [...byProv.values()][0] ?? [];
  return own.length ? [best(own)] : [];
}

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("critic:" + user.id, 40, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  const content = typeof b.content === "string" ? b.content : "";
  const lines = content.split("\n").length;
  if (!content.trim()) return Response.json({ error: "Chưa có nội dung để phản biện." }, { status: 400 });
  if (content.length > 200_000 || lines > 4000) return Response.json({ error: "Sản phẩm quá dài để phản biện." }, { status: 413 });
  const gen = typeof b.model === "string" ? b.model : "";
  const { allowed, usable } = await usableModels(user);
  const picks = pickCritics(usable.length ? usable : allowed, gen ? vendorOf(gen) : "", gen);
  if (!picks.length) return Response.json({ error: "Synchro chưa được kết nối với model nào." }, { status: 503 });
  const kind = LABEL[String(b.type)] ?? "code";
  const ask = `Sản phẩm: “${String(b.title ?? "").slice(0, 200)}” (${kind}${b.lang ? `, ${String(b.lang).slice(0, 30)}` : ""}).${typeof b.question === "string" && b.question.trim() ? `\nYêu cầu gốc của người dùng: ${b.question.trim().slice(0, 1500)}` : ""}\n\n<code>\n${numbered(content)}\n</code>`;
  const runs = await Promise.allSettled(picks.map(async (key) => {
    const text = await oneShot(user, key, CRITIC, [{ role: "user", content: ask }], { maxTokens: 1800 });
    return { by: key, findings: parseFindings(text, lines) };
  }));
  const ok = runs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) {
    const e = (runs[0] as PromiseRejectedResult).reason;
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Hội đồng phản biện chưa trả lời được. Hãy thử lại." }, { status: 502 });
  }
  const findings: Finding[] = mergeFindings(ok);
  return Response.json({ findings, by: ok.map((r) => r.by) });
});
