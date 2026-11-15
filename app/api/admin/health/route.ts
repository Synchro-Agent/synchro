import fs from "node:fs";
import path from "node:path";
import { audit, clientIp, handle, limit, requireAdmin, sameOrigin, appUrl } from "../../../../server/authstore";
import { mailDnsStatus, sendMailNow } from "../../../../server/mailer";
import { testMail } from "../../../../server/mailtpl";
import { memReport } from "../../../../server/memstat";
import { loopReport } from "../../../../server/loopdelay";
import { opsProblems, opsSnapshot } from "../../../../server/ops";
import { agentAlive, wsConfigured } from "../../../../server/workspace";
import { latencySummary } from "../../../../server/tracing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const build = (() => { try { return fs.readFileSync(path.join(process.cwd(), process.env.NEXT_DIST_DIR || ".next", "BUILD_ID"), "utf8").trim(); } catch { return "dev"; } })();

// Cài đặt → Sức khỏe hệ thống. Chỉ quản trị viên; không có nội dung chat.
export const GET = handle(async (req) => {
  requireAdmin(req);
  const snap = opsSnapshot();
  const [agent, dns] = await Promise.all([wsConfigured() ? agentAlive() : Promise.resolve(null), mailDnsStatus()]);
  // Độ trễ từng chặng của lượt chat: 500 lượt gần nhất, hôm nay và 7 ngày (p50 / p95 theo hãng).
  const today = latencySummary(1), latency = { ...today, week: latencySummary(7).daily };
  return Response.json({ ...snap, problems: opsProblems(snap), agent, dns, build, uptimeSec: Math.round(process.uptime()), latency, mem: memReport(), loop: loopReport() });
});

// { action: "mail_test", lang }: gửi thử tới chính email của quản trị viên và chờ kết quả (không cho nhập địa chỉ khác: nút này không phải công cụ gửi thư).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { action, lang } = await req.json().catch(() => ({}));
  if (action !== "mail_test") return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
  limit("mail-test:" + user.id, 10, 60 * 60_000);
  const l = lang === "en" ? "en" : "vi";
  const when = `${new Date().toLocaleString(l === "vi" ? "vi-VN" : "en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })} (GMT+7)`;
  const r = await sendMailNow(user.email, testMail({ base: appUrl(req), lang: l, when }));
  audit("admin_mail_test", { actor: user, ip: clientIp(req), detail: r.ok ? "ok" : (r.error ?? "").slice(0, 200) });
  return Response.json({ ...r, to: user.email });
});
