import { clientIp, limit } from "../../../server/authstore";
import { opsEvent } from "../../../server/ops";
import { timed } from "../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const host = (u: unknown) => {
  const s = String(u ?? "").slice(0, 500);
  // inline, eval, data, blob, wasm: từ khóa của trình duyệt, không có gì để giấu.
  if (!/^https?:/i.test(s)) return s.split(":")[0].slice(0, 30) || "?";
  try { return new URL(s).origin; } catch { return "?"; }
};
const pathOf = (u: unknown) => { try { return new URL(String(u)).pathname.slice(0, 60); } catch { return "?"; } };

// Báo cáo của CSP chạy thử (next.config.ts): cho biết chặn thật thì có gì hỏng, và có script lạ nào đang chạy không. Ai cũng gửi được nên chỉ giữ nguồn và đường dẫn,
// không giữ truy vấn; giới hạn theo IP; không bao giờ báo lỗi về cho trình duyệt.
export const POST = timed(async (req: Request) => {
  try {
    limit("csp:" + clientIp(req), 30, 10 * 60_000);
    if (Number(req.headers.get("content-length") ?? 0) > 16_384) return new Response(null, { status: 204 });
    const text = (await req.text()).slice(0, 16_384);
    const b = JSON.parse(text) as { "csp-report"?: Record<string, unknown> };
    const r = b["csp-report"];
    if (r) opsEvent("csp", String(r["effective-directive"] ?? r["violated-directive"] ?? "?").split(" ")[0].slice(0, 40), `${host(r["blocked-uri"])} @ ${pathOf(r["document-uri"])}`);
  } catch { /* quá giới hạn hoặc nội dung lạ: bỏ qua */ }
  return new Response(null, { status: 204 });
});
