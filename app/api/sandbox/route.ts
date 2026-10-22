// Tier 2: chạy code trong sandbox cloud E2B. Cần E2B_API_KEY.
import { Sandbox } from "@e2b/code-interpreter";
import { authGate } from "../../authstore";

export async function POST(req: Request) {
  const denied = authGate(req); if (denied) return denied;
  if (!process.env.E2B_API_KEY) return Response.json({ error: "Chưa cấu hình E2B_API_KEY nên chưa dùng được sandbox server." }, { status: 501 });
  const { lang = "python", code } = await req.json();
  if (typeof code !== "string" || code.length > 100_000) return Response.json({ error: "Code không hợp lệ" }, { status: 400 });
  let sbx: Sandbox | undefined;
  try {
    sbx = await Sandbox.create({ timeoutMs: 60_000 });
    const language = /^(js|javascript|node|ts|typescript)$/i.test(lang) ? "js" : /^(bash|sh)$/i.test(lang) ? "bash" : "python";
    const ex = await sbx.runCode(code, { language });
    return Response.json({ out: ex.logs.stdout.join(""), err: ex.logs.stderr.join("") + (ex.error ? `${ex.error.name}: ${ex.error.value}\n${ex.error.traceback}` : "") });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  } finally {
    await sbx?.kill().catch(() => {});
  }
}
