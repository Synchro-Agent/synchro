import { audit, AuthError, isAdmin } from "../../../../../server/authstore";
import { forget } from "../../../../../server/ai/cli_auth";
import { install } from "../../../../../server/ai/cli_runtime";
import { redact } from "../../../../../server/ai/errors";
import { engineRoute, noStore } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Quản trị viên cài / cập nhật CLI chính chủ trên máy chủ (claude, codex qua npm; agy qua script cài của Google).
const busy = new Set<string>();
export const POST = engineRoute(async (_req, user, cli) => {
  if (!isAdmin(user)) throw new AuthError("Chỉ quản trị viên mới cài được CLI.", 403);
  if (busy.has(cli)) throw new AuthError("CLI này đang được cài, đợi một chút nhé.", 409);
  busy.add(cli);
  try {
    const r = await install(cli);
    forget(cli);
    audit("engine.install", { actor: user, detail: `${cli} ${r.ok ? r.version : "lỗi"}` });
    return Response.json({ ok: r.ok, version: r.version, output: redact(r.output).slice(-1500) }, noStore);
  } finally { busy.delete(cli); }
});
