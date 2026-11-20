// Phong cách người dùng: GET danh sách ("Phong cách của tôi" và phong cách vừa đọc), POST đọc phong cách mới
// từ liên kết, ảnh hoặc artifact của chính người dùng. { from: "url", url } | { from: "image", media_type, data } |
// { from: "artifact", conv, ident, preset?, png?, content? }, kèm name?, save? (save: lưu thành "Phong cách của tôi").
// content: bản artifact trình duyệt đang mở, dùng khi máy chủ chưa lưu artifact đó (đoạn chat vừa đồng bộ từ máy khác);
// chỉ để đọc data-sx-mix / data-sx-preset, token vẫn lấy từ lịch sử của chính người dùng hoặc từ phong cách có sẵn.
import { handle, requireUser } from "../../../server/authstore";
import { route } from "../../../server/route";
import { briefFacets } from "../../../shared/designpick";
import { addStyle, listStyles, publicStyle, StyleError, updateStyle } from "../../../server/designstyles";
import { artifactTokens, FollowError, followStyle } from "../../../server/designfollow";
import { followBase, mixRecord } from "../../../server/designrefs";
import { getArtifactByIdent } from "../../../server/artifactstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const uid = requireUser(req).user.id;
  return Response.json({ styles: listStyles(uid) });
});

const FOLLOW_FAIL = "Không đọc được phong cách";
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : "");
const errorOf = (e: unknown) => {
  const msg = e instanceof Error ? e.message : "";
  // reason: câu mẫu và giá trị điền, để giao diện tiếng Anh dịch được lý do.
  const reason = e instanceof FollowError ? { key: e.tpl, vars: e.vars } : null;
  if (reason) return Response.json({ error: `${FOLLOW_FAIL}: ${msg}.`, reason }, { status: 422 });
  if (e instanceof StyleError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

const LIMIT = { key: "design-styles", max: 60, windowMs: 3_600_000 };
export const POST = route({ json: true, limit: LIMIT }, async ({ req, user }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Đề đang soạn (nếu có) chọn mẫu thư viện để mượn thang chữ, hình khối; không có thì theo mặc định chung.
  const facets = briefFacets(str(b.brief, 4000), "graphic")!;
  const name = str(b.name, 200) || undefined;
  try {
    let style;
    if (b.from === "url" && str(b.url, 2000)) {
      const base = followBase(facets, user.id);
      style = await followStyle({ uid: user.id, facets, base, url: str(b.url, 2000), name });
    } else if (b.from === "image" && str(b.data, 17_000_000)) {
      const image = { media_type: str(b.media_type, 40), data: str(b.data, 17_000_000) };
      style = await followStyle({ uid: user.id, facets, base: followBase(facets, user.id), image, name });
    } else if (b.from === "artifact") {
      const art = getArtifactByIdent(user.id, str(b.conv, 64), str(b.ident, 200));
      const content = art?.versions.at(-1)?.content ?? (str(b.content, 400_000) || null);
      if (!content) return Response.json({ error: "Không tìm thấy artifact này." }, { status: 404 });
      const png = str(b.png, 17_000_000) ? { media_type: "image/png", data: str(b.png, 17_000_000) } : undefined;
      const src = { content, preset: str(b.preset, 40) || undefined, png };
      const tokens = await artifactTokens(user.id, src, mixRecord, facets);
      const image = png ? Buffer.from(png.data, "base64") : null;
      const one = { kind: "mine" as const, name: name ?? art?.title ?? "", source: "artifact", tokens, image };
      const saved = await addStyle(user.id, one);
      return Response.json({ style: publicStyle(saved) });
    } else {
      return Response.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
    }
    if (b.save === true) style = updateStyle(user.id, style.id, { save: true, name });
    return Response.json({ style: publicStyle(style) });
  } catch (e) {
    return errorOf(e);
  }
});
