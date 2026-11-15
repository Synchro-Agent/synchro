// Mật khẩu (băm scrypt, so sánh thời gian hằng, kiểm tra độ mạnh) và chuẩn hóa email.
import "server-only";
import crypto from "node:crypto";
import { PW_MAX, PW_MIN } from "./config";
import { AuthError } from "./errors";

// ---- mật khẩu: scrypt, muối ngẫu nhiên, so sánh thời gian hằng ----
const SCRYPT = { N: 16384, r: 8, p: 1 };
const scrypt = (pw: string, salt: Buffer, len: number, o: crypto.ScryptOptions) =>
  new Promise<Buffer>((ok, no) => crypto.scrypt(pw.normalize("NFKC"), salt, len, o, (e, k) => (e ? no(e) : ok(k))));
const DUMMY = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const k = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${k.toString("base64")}`;
}

// Luôn chạy scrypt kể cả khi không có tài khoản để không lộ qua thời gian phản hồi.
export async function verifyPassword(pw: string, stored: string | null) {
  const [, n, r, p, salt, hash] = (stored ?? DUMMY).split("$");
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, { N: +n, r: +r, p: +p });
  return !!stored && crypto.timingSafeEqual(got, want);
}

const COMMON = new Set(["12345678", "123456789", "1234567890", "password", "password1", "qwertyui", "qwerty123", "11111111", "abc12345", "iloveyou", "00000000", "88888888"]);
export function checkPassword(pw: unknown, email = "") {
  if (typeof pw !== "string" || pw.length < PW_MIN) throw new AuthError(`Mật khẩu cần ít nhất ${PW_MIN} ký tự.`);
  if (pw.length > PW_MAX) throw new AuthError("Mật khẩu quá dài.");
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw) || pw.toLowerCase() === email.toLowerCase()) throw new AuthError("Mật khẩu này quá dễ đoán. Hãy chọn mật khẩu khác.");
  return pw;
}

export function normEmail(e: unknown) {
  const s = typeof e === "string" ? e.trim().toLowerCase() : "";
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new AuthError("Email không hợp lệ.");
  return s;
}
