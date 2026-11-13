// Thử quyền ghi thật lên Cloudflare R2 trước khi lưu cấu hình sao lưu liên tục (app/litestream.ts): ghi một tệp nhỏ rồi xóa nó.
// Định dạng khóa đúng chưa đủ: token chỉ có quyền đọc, sai bucket, sai Account ID đều chỉ lộ ra khi litestream ghi (403 AccessDenied trong nhật ký).
// Ký yêu cầu bằng AWS Signature V4 (R2 nói chuyện theo giao thức S3), không cần thêm thư viện. Lỗi của R2 đổi thành câu tiếng Việt có hướng sửa.
import crypto from "node:crypto";

export type R2Cfg = { accountId: string; bucket: string; accessKeyId: string; secret: string; prefix: string };
export type R2Err = { code: string; status: number; message: string };

/** Chỉ cho kiểm thử: thay https://<account>.r2.cloudflarestorage.com bằng một máy chủ giả. Máy chủ thật không đặt biến này. */
const endpoint = (acc: string) => process.env.SYNCHRO_R2_ENDPOINT || `https://${acc}.r2.cloudflarestorage.com`;
const sha = (b: string | Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, s: string) => crypto.createHmac("sha256", k).update(s).digest();
const enc = (seg: string) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Một yêu cầu S3 đã ký (SigV4, vùng "auto" của R2). */
export function signS3(c: R2Cfg, method: string, key: string, body: Buffer, now = new Date()) {
  const base = new URL(endpoint(c.accountId));
  const p = `/${[c.bucket, ...key.split("/")].map(enc).join("/")}`;
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, ""), day = amz.slice(0, 8);
  const hash = sha(body);
  const headers: Record<string, string> = { host: base.host, "x-amz-content-sha256": hash, "x-amz-date": amz };
  const names = Object.keys(headers).sort();
  const canon = [method, p, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), hash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha(canon)].join("\n");
  const k = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), "auto"), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", k).update(toSign).digest("hex");
  return {
    url: `${base.origin}${p}`,
    headers: { "x-amz-content-sha256": hash, "x-amz-date": amz, authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}` },
  };
}

/** Lỗi R2 / S3 → câu cho quản trị viên (tiếng Việt; bản tiếng Anh ở app/i18n-auth.ts). */
export function r2Message(code: string, status: number): string {
  if (code === "AccessDenied" || (status === 403 && !code)) return "Token R2 chưa có quyền ghi vào bucket này. Tạo token với quyền Object Read & Write cho đúng bucket rồi dán lại cả hai khóa.";
  if (code === "NoSuchBucket") return "Không có bucket này trong tài khoản Cloudflare. Kiểm tra lại tên bucket và Account ID.";
  if (code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch" || code === "Unauthorized" || status === 401) return "Access Key ID hoặc Secret Access Key không đúng. Dán lại cả hai khóa của cùng một token R2.";
  if (code === "InvalidBucketName") return "Tên bucket R2 không hợp lệ.";
  if (code === "network") return "Không kết nối được tới R2. Kiểm tra Account ID (32 ký tự, ở trang R2 của Cloudflare) và mạng của máy chủ.";
  return "R2 từ chối lần ghi thử. Kiểm tra token, bucket và Account ID.";
}

async function call(c: R2Cfg, method: "PUT" | "DELETE", key: string, body: Buffer): Promise<R2Err | null> {
  const s = signS3(c, method, key, body);
  let res: Response;
  try {
    res = await fetch(s.url, { method, headers: s.headers, body: method === "PUT" ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(15_000), redirect: "manual" });
  } catch { return { code: "network", status: 0, message: r2Message("network", 0) }; }
  if (res.ok) { await res.arrayBuffer().catch(() => {}); return null; }
  const text = await res.text().catch(() => "");
  const code = /<Code>([^<]{1,64})<\/Code>/.exec(text)?.[1] ?? "";
  return { code: code || `HTTP ${res.status}`, status: res.status, message: r2Message(code, res.status) };
}

/** Ghi rồi xóa một tệp nhỏ trong thư mục sao lưu. null: ghi và xóa được (đúng quyền litestream cần). */
export async function probeR2Write(c: R2Cfg): Promise<R2Err | null> {
  const key = `${c.prefix.replace(/\/+$/, "")}/.synchro-write-test-${crypto.randomBytes(6).toString("hex")}`;
  const put = await call(c, "PUT", key, Buffer.from(`synchro write test ${new Date().toISOString()}\n`));
  if (put) return put;
  // Litestream xóa tệp cũ theo hạn giữ: token phải xóa được, không chỉ ghi.
  return call(c, "DELETE", key, Buffer.alloc(0));
}
