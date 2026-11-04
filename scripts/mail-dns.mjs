// In các bản ghi DNS để thư của Synchro không vào spam: node scripts/mail-dns.mjs <IPv4 của máy chủ> (chạy ở máy chủ, trong thư mục app).
// Không in khóa riêng; chỉ in khóa công khai suy ra từ data/mail-dkim.pem (chưa có thì tạo, giống app/mailer.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ip = process.argv[2];
if (!ip) { console.error("Cách dùng: node scripts/mail-dns.mjs <IPv4 của máy chủ>"); process.exit(1); }
const f = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "mail-dkim.pem");
if (!fs.existsSync(f)) {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  fs.writeFileSync(f, privateKey, { mode: 0o600, flag: "wx" });
}
const pub = crypto.createPublicKey(fs.readFileSync(f, "utf8")).export({ type: "spki", format: "der" }).toString("base64");
console.log(`TXT  @                  v=spf1 ip4:${ip} -all`);
console.log(`TXT  synchro._domainkey  v=DKIM1; k=rsa; p=${pub}`);
console.log(`TXT  _dmarc              v=DMARC1; p=none; adkim=s; aspf=s`);
