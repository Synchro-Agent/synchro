// Thiết bị khóa truy cập (WebAuthn) giả bằng phần mềm cho kiểm thử: tự tạo cặp khóa P-256, dựng attestation "none" và chữ ký đăng nhập như
// trình duyệt. Dùng chung cho tests/api/passkeys.test.mjs và tests/api/passkey-origins.test.mjs.
import crypto from "node:crypto";

// ---- CBOR tối thiểu (số nguyên, chuỗi byte, chuỗi chữ, map) ----
const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : (() => { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; })();
function cbor(v) {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: " + typeof v);
}
export const b64u = (b) => Buffer.from(b).toString("base64url");
export const sha = (b) => crypto.createHash("sha256").update(b).digest();

/** Thiết bị giả: một khóa P-256, bộ đếm chữ ký, userHandle. origin, rpId là mặc định; từng lần register / assert vẫn đổi được. */
export function authenticator({ origin: O = "http://localhost:3200", rpId: RP = "localhost" } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credId = crypto.randomBytes(32);
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  let counter = 0, userHandle = "";
  const count = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    id: b64u(credId),
    get counter() { return counter; },
    register(opts, { origin = O, rpId = RP } = {}) {
      userHandle = opts.user.id;
      const cd = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: opts.challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), count(counter), Buffer.alloc(16), len, credId, cose]);
      const att = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id: b64u(credId), rawId: b64u(credId), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform", response: { clientDataJSON: b64u(cd), attestationObject: b64u(att), transports: ["internal"] } };
    },
    assert(opts, { origin = O, rpId = RP, uv = true, at, handle } = {}) {
      counter = at ?? counter + 1;
      const cd = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha(rpId), Buffer.from([uv ? 0x05 : 0x01]), count(counter)]);
      const sig = crypto.sign("sha256", Buffer.concat([authData, sha(cd)]), privateKey);
      return { id: b64u(credId), rawId: b64u(credId), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig), userHandle: handle ?? userHandle } };
    },
  };
}
