import { exportSkill, ExportError, zipResponse } from "../../../../skillexport";
import { current, featureGate } from "../../../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Tải về skill thành tệp .zip: thư mục skill, mọi phiên bản cũ và toàn bộ thông tin (app/skillexport.ts). ?lang=en cho README tiếng Anh.
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const lang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "vi";
  try {
    const { filename, buf } = await exportSkill(current(req)!.user.id, (await params).name, lang);
    return zipResponse(filename, buf);
  } catch (e) {
    if (e instanceof ExportError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[skills/export]", e);
    return Response.json({ error: lang === "en" ? "Could not export this skill." : "Không xuất được skill này." }, { status: 500 });
  }
}

