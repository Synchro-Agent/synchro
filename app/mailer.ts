// Gửi email của Synchro (chỉ chạy ở máy chủ). Không cần dịch vụ ngoài: máy chủ tự nói chuyện với máy chủ thư của người nhận (bản ghi MX) và ký DKIM bằng khóa
// riêng lưu trong thư mục dữ liệu; SPF, DKIM, DMARC khai báo ở DNS (node scripts/mail-dns.mjs in sẵn). Muốn đi qua dịch vụ gửi thư thì đặt SMTP_URL.
// Gửi ở nền: người yêu cầu không phải chờ, và thời gian trả lời không lộ email có tài khoản hay không. Lỗi tạm (máy chủ thư bận, greylisting) thì thử lại.
// MAIL_CAPTURE_DIR (chỉ bản giả lập): ghi ra tệp thay vì gửi. Thư gửi lỗi lần cuối hiện cho quản trị viên ở Cài đặt → Sức khỏe hệ thống (ops.ts) và nhật ký bảo mật.
// Chỉ biết được lỗi trong lúc gửi (máy chủ thư từ chối thẳng): thư trả về sau đó đi tới no-reply@, nơi Synchro không có hộp thư nhận.
import crypto from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Mail } from "./mailtpl";
import { isPrivate } from "./safefetch";
import { audit } from "./authstore";
import { opsEvent } from "./ops";

const dataDir = () => process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const DKIM_SELECTOR = "synchro";
const RETRY_MIN = [1, 5, 15];

export const mailDomain = () => {
  try { return new URL(process.env.APP_URL ?? "https://synchro.net.nz").hostname; } catch { return "synchro.net.nz"; }
};
const fromAddr = () => process.env.MAIL_FROM || `Synchro <no-reply@${mailDomain()}>`;

/** Khóa DKIM: tạo một lần, nằm trong thư mục dữ liệu nên có trong bản sao lưu và không đổi qua các lần deploy. */
export function dkimKey() {
  const f = path.join(dataDir(), "mail-dkim.pem");
  try { return fs.readFileSync(f, "utf8"); } catch {}
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  // wx: tiến trình khác vừa tạo trước thì dùng khóa đó, không ghi đè.
  try { fs.writeFileSync(f, privateKey, { mode: 0o600, flag: "wx" }); return privateKey; } catch { return fs.readFileSync(f, "utf8"); }
}

// Lỗi vĩnh viễn (địa chỉ không tồn tại, bị từ chối hẳn): thử lại vô ích.
class Permanent extends Error {}
const permanent = (e: unknown) => { const c = (e as { responseCode?: number }).responseCode; return typeof c === "number" && c >= 500 && c < 600; };

async function mxHosts(domain: string) {
  const mx = await dns.resolveMx(domain).catch(() => [] as { exchange: string; priority: number }[]);
  // Theo RFC 5321: không có MX thì dùng chính tên miền. MX "." nghĩa là tên miền này không nhận thư.
  if (mx.some((m) => m.exchange === "" || m.exchange === ".")) throw new Permanent("tên miền không nhận thư");
  return mx.length ? mx.sort((a, b) => a.priority - b.priority).slice(0, 3).map((m) => m.exchange) : [domain];
}

async function deliver(to: string, m: Mail) {
  const nodemailer = (await import("nodemailer")).default;
  const domain = mailDomain();
  const dkim = { domainName: domain, keySelector: DKIM_SELECTOR, privateKey: dkimKey() };
  const msg = { from: fromAddr(), to, subject: m.subject, html: m.html, text: m.text, headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" } };
  const url = process.env.SMTP_URL;
  if (url) return void (await nodemailer.createTransport(url, { dkim }).sendMail(msg));
  const rcpt = to.split("@").pop() ?? "";
  let last: unknown = new Error("không tìm thấy máy chủ thư");
  for (const host of await mxHosts(rcpt)) {
    // IPv4: máy chủ có bản ghi PTR cho IPv4; Gmail từ chối thư từ IPv6 không có PTR. Bỏ qua địa chỉ nội bộ (tên miền người nhận do người dùng tự khai khi đăng ký).
    const ips = await dns.resolve4(host).catch(() => [] as string[]);
    const ip = ips.find((x) => !isPrivate(x));
    if (!ip) continue;
    try {
      const t = nodemailer.createTransport({ host: ip, port: 25, secure: false, name: process.env.MAIL_HELO || os.hostname(), connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, tls: { servername: host, rejectUnauthorized: false }, dkim });
      await t.sendMail(msg);
      return;
    } catch (e) {
      if (permanent(e)) throw new Permanent((e as Error).message);
      last = e;
    }
  }
  throw last;
}

export type MailKind = "reset" | "changed" | "verify" | "signup_taken" | "alert" | "test" | "other";

// Bản giả lập: ghi ra tệp. Địa chỉ @bounce.synchro.test giả lập máy chủ thư từ chối hẳn, để kiểm thử đường báo lỗi cho quản trị viên.
function capture(dir: string, to: string, m: Mail) {
  if (to.endsWith("@bounce.synchro.test")) throw new Permanent("550 5.1.1 mailbox does not exist");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}.json`), JSON.stringify({ to, ...m }));
}
const send = async (to: string, m: Mail) => { const dir = process.env.MAIL_CAPTURE_DIR; if (dir) capture(dir, to, m); else await deliver(to, m); };

// Nhật ký máy chủ chỉ ghi tên miền người nhận. Thất bại hẳn thì ghi cả vào nhật ký bảo mật cho quản trị viên (nơi đã có email của tài khoản).
function logOk(where: string | undefined, kind: MailKind, tries: number) {
  console.log(`[mail] đã gửi ${kind} tới @${where}${tries ? ` sau ${tries + 1} lần` : ""}`);
  opsEvent("mail_ok", kind, `@${where}`);
}
function logFail(to: string, where: string | undefined, kind: MailKind, e: unknown, final: boolean, retryIn?: number) {
  const msg = String((e as Error).message).slice(0, 300);
  console.error(`[mail] lỗi gửi ${kind} tới @${where}${retryIn ? `, thử lại sau ${retryIn} phút` : ""}: ${msg}`);
  if (!final) return;
  opsEvent("mail_fail", kind, `@${where}: ${msg}`);
  try { audit("mail_failed", { targetEmail: to, detail: `${kind}: ${msg}`.slice(0, 300) }); } catch { /* không ghi được thì vẫn còn nhật ký máy chủ */ }
}

/** Gửi ở nền, không bao giờ ném lỗi ra ngoài: người yêu cầu không phải chờ. Lỗi cuối cùng hiện ở Cài đặt → Sức khỏe hệ thống và nhật ký bảo mật. */
export function sendMail(to: string, m: Mail, kind: MailKind = "other") {
  const where = to.split("@").pop();
  const go = (n: number) => {
    send(to, m).then(() => logOk(where, kind, n), (e) => {
      const again = !(e instanceof Permanent) && n < RETRY_MIN.length;
      logFail(to, where, kind, e, !again, again ? RETRY_MIN[n] : undefined);
      if (again) setTimeout(() => go(n + 1), RETRY_MIN[n] * 60_000).unref?.();
    });
  };
  go(0);
}

let dnsCache: { at: number; v: Awaited<ReturnType<typeof readDns>> | null } | null = null;
async function readDns() {
  const domain = mailDomain();
  const txt = (name: string) => Promise.race([dns.resolveTxt(name).then((r) => r.map((x) => x.join("")), () => [] as string[]), new Promise<string[]>((ok) => setTimeout(() => ok([]), 4000))]);
  const [root, dk, dm] = await Promise.all([txt(domain), txt(`${DKIM_SELECTOR}._domainkey.${domain}`), txt(`_dmarc.${domain}`)]);
  let dkim = false;
  try { dkim = dk.join("").replace(/\s+/g, "").includes(crypto.createPublicKey(dkimKey()).export({ type: "spki", format: "der" }).toString("base64")); } catch { /* chưa có khóa */ }
  return { domain, spf: root.some((x) => /^v=spf1\b/i.test(x)), dkim, dmarc: dm.some((x) => /^v=DMARC1\b/i.test(x)) };
}
/** SPF, DKIM (khớp đúng khóa đang ký), DMARC có đang công bố không. Chỉ tra DNS, nhớ 10 phút. Bản giả lập không tra. */
export async function mailDnsStatus() {
  if (process.env.MAIL_CAPTURE_DIR) return null;
  if (!dnsCache || Date.now() - dnsCache.at > 600_000) dnsCache = { at: Date.now(), v: await readDns().catch(() => null) };
  return dnsCache!.v;
}

/** Gửi thử ngay và chờ kết quả, không thử lại (nút của quản trị viên). "Đã gửi" chỉ nghĩa là máy chủ thư của người nhận đã nhận thư, chưa chắc vào hộp thư chính. */
export async function sendMailNow(to: string, m: Mail, kind: MailKind = "test"): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now(), where = to.split("@").pop();
  try { await send(to, m); logOk(where, kind, 0); return { ok: true, ms: Date.now() - t0 }; }
  catch (e) { logFail(to, where, kind, e, true); return { ok: false, ms: Date.now() - t0, error: String((e as Error).message).slice(0, 300) }; }
}
