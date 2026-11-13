#!/usr/bin/env node
// Giải mã bản chụp tệp từ R2 (scripts/backup-offsite.sh) khi máy khôi phục không có sẵn lệnh "age": chỉ cần Node, không thư viện ngoài.
//   node scripts/age-decrypt.mjs <khóa-riêng.txt> <files-….tar.gz.age> > files.tar.gz && tar -xzf files.tar.gz
// Hỗ trợ đúng loại age tạo ra ở đây: người nhận X25519 (age1…), định dạng age-encryption.org/v1. Có lệnh age thì dùng nó cũng được:
//   age -d -i <khóa-riêng.txt> <tệp> | tar -xz
import crypto from "node:crypto";
import fs from "node:fs";

const [keyFile, inFile] = process.argv.slice(2);
if (!keyFile || !inFile) { console.error("Cách dùng: node scripts/age-decrypt.mjs <khóa-riêng.txt> <tệp.age> > ra"); process.exit(2); }
const CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Decode(s) {
  s = s.toLowerCase();
  const i = s.lastIndexOf("1"), d = [...s.slice(i + 1)].map((c) => CH.indexOf(c));
  if (i < 1 || d.some((x) => x < 0)) throw new Error("Khóa không đúng định dạng bech32");
  const data = d.slice(0, -6); let acc = 0, bits = 0; const out = [];
  for (const v of data) { acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); } }
  return { hrp: s.slice(0, i), bytes: Buffer.from(out) };
}
const b64 = (s) => Buffer.from(s, "base64");
const hkdf = (ikm, salt, info, n = 32) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, n));
const open = (key, nonce, ct) => { const d = crypto.createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 }); d.setAuthTag(ct.subarray(ct.length - 16)); return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); };

const secLine = fs.readFileSync(keyFile, "utf8").split("\n").map((l) => l.trim()).find((l) => l.startsWith("AGE-SECRET-KEY-1"));
if (!secLine) { console.error("Không thấy dòng AGE-SECRET-KEY-1… trong tệp khóa"); process.exit(2); }
const sk = bech32Decode(secLine).bytes;
const priv = crypto.createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: sk.toString("base64url"), x: "" }, format: "jwk" });
const pubRaw = Buffer.from(crypto.createPublicKey(priv).export({ format: "jwk" }).x, "base64url");

const fd = fs.openSync(inFile, "r");
// Phần đầu là văn bản, kết thúc ở dòng "--- <mac>".
const head = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 64 * 1024)); fs.readSync(fd, head, 0, head.length, 0);
const end = head.indexOf("\n---"), macEnd = head.indexOf("\n", end + 4);
if (!head.subarray(0, 22).equals(Buffer.from("age-encryption.org/v1\n")) || end < 0 || macEnd < 0) { console.error("Không phải tệp age v1"); process.exit(1); }
const lines = head.subarray(0, end).toString("utf8").split("\n");
let fileKey = null;
for (let i = 1; i < lines.length; i++) {
  const a = lines[i].split(" ");
  if (a[0] !== "->") continue;
  let body = ""; for (let j = i + 1; j < lines.length && !lines[j].startsWith("->"); j++) body += lines[j];
  if (a[1] !== "X25519") continue;
  const share = b64(a[2]);
  const shared = crypto.diffieHellman({ privateKey: priv, publicKey: crypto.createPublicKey({ key: { kty: "OKP", crv: "X25519", x: share.toString("base64url") }, format: "jwk" }) });
  const wrap = hkdf(shared, Buffer.concat([share, pubRaw]), "age-encryption.org/v1/X25519");
  try { fileKey = open(wrap, Buffer.alloc(12), b64(body)); break; } catch { /* không phải người nhận này */ }
}
if (!fileKey) { console.error("Khóa riêng này không mở được tệp (sai khóa?)"); process.exit(1); }
const mac = crypto.createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(head.subarray(0, end + 4)).digest();
if (!mac.equals(b64(head.subarray(end + 5, macEnd).toString("utf8")))) { console.error("Phần đầu tệp bị sửa (MAC sai)"); process.exit(1); }
let pos = macEnd + 1;
const nonce = Buffer.alloc(16); fs.readSync(fd, nonce, 0, 16, pos); pos += 16;
const key = hkdf(fileKey, nonce, "payload");
const total = fs.fstatSync(fd).size, CHUNK = 64 * 1024 + 16, buf = Buffer.alloc(CHUNK);
for (let n = 0n; pos < total; n++) {
  const len = fs.readSync(fd, buf, 0, CHUNK, pos); pos += len;
  const last = pos >= total, cn = Buffer.alloc(12); cn.writeBigUInt64BE(n, 3); cn[11] = last ? 1 : 0;
  fs.writeSync(1, open(key, cn, buf.subarray(0, len)));
}
fs.closeSync(fd);
