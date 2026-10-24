import { appUrl } from "../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client ID Metadata Document: địa chỉ của chính tài liệu này là client_id của Synchro khi đăng nhập connector,
// nên máy chủ đăng nhập hỗ trợ chuẩn này không cần đăng ký trước.
export function GET(req: Request) {
  const base = appUrl(req);
  return Response.json({
    client_id: `${base}/oauth/client-metadata.json`, client_name: "Synchro", client_uri: base, logo_uri: `${base}/apple-icon.png`,
    redirect_uris: [`${base}/api/connectors/oauth/callback`], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  }, { headers: { "cache-control": "public, max-age=3600" } });
}
