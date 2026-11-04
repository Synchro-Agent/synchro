// Gửi email của Synchro (chỉ chạy ở máy chủ). Không cần dịch vụ ngoài: máy chủ tự nói chuyện với máy chủ thư của người nhận (bản ghi MX) và ký DKIM bằng khóa
// riêng lưu trong thư mục dữ liệu; SPF, DKIM, DMARC khai báo ở DNS (node scripts/mail-dns.mjs in sẵn). Muốn đi qua dịch vụ gửi thư thì đặt SMTP_URL.
// Gửi ở nền: người yêu cầu không phải chờ, và thời gian trả lời không lộ email có tài khoản hay không. Lỗi tạm (máy chủ thư bận, greylisting) thì thử lại.
// MAIL_CAPTURE_DIR (chỉ bản giả lập): ghi ra tệp thay vì gửi.
import crypto from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Mail } from "./mailtpl";
import { isPrivate } from "./safefetch";

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

/** Gửi ở nền, không bao giờ ném lỗi ra ngoài. Nhật ký chỉ ghi tên miền người nhận. */
export function sendMail(to: string, m: Mail) {
  const dir = process.env.MAIL_CAPTURE_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}.json`), JSON.stringify({ to, ...m }));
    return;
  }
  const where = to.split("@").pop();
  const go = (n: number) => {
    deliver(to, m).then(() => console.log(`[mail] đã gửi tới @${where}: ${m.subject}`), (e) => {
      const again = !(e instanceof Permanent) && n < RETRY_MIN.length;
      console.error(`[mail] lỗi gửi tới @${where}${again ? `, thử lại sau ${RETRY_MIN[n]} phút` : ""}: ${String((e as Error).message).slice(0, 300)}`);
      if (again) setTimeout(() => go(n + 1), RETRY_MIN[n] * 60_000).unref?.();
    });
  };
  go(0);
}
