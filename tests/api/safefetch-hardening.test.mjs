// F4 — safefetch.ts: isPrivate chặn thêm dải IPv6 (ff00::/8 multicast, fec0::/10 site-local, 2002::/16 6to4),
// và trần đọc mặc định 10MB (capBody qua safeFetch). Tự chạy được, không cần máy chủ (loadTs).
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };

try {
  const { safefetch: S } = await loadTs(["safefetch"]);

  console.log("1. isPrivate chặn các dải IPv6 mới");
  const priv = [
    ["ff02::1", "multicast ff00::/8"],
    ["ff05::1:3", "multicast site-local"],
    ["fec0::1", "site-local fec0::/10"],
    ["feff::abcd", "site-local cuối dải"],
    ["2002:7f00:1::1", "6to4 2002::/16"],
    ["2002:a9fe:0101::", "6to4 bọc 169.254"],
  ];
  for (const [ip, why] of priv) ok(S.isPrivate(ip) === true, `${ip} (${why}) → riêng tư`, S.isPrivate(ip));

  console.log("2. isPrivate vẫn chặn các dải cũ");
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) ok(S.isPrivate(ip) === true, `${ip} → riêng tư`, S.isPrivate(ip));

  console.log("3. isPrivate KHÔNG chặn địa chỉ công khai");
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2400:cb00::1"]) ok(S.isPrivate(ip) === false, `${ip} → công khai`, S.isPrivate(ip));

  console.log("4. Trần đọc 10MB mặc định cắt phản hồi quá lớn");
  // Giả lập fetch trả về một luồng vô hạn các khối 64KB; safeFetch phải ném FetchBlocked sau khi vượt trần.
  const realFetch = globalThis.fetch;
  const chunk = new Uint8Array(64 * 1024);
  globalThis.fetch = async () => {
    const body = new ReadableStream({ pull(c) { c.enqueue(chunk); } });
    return new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
  };
  try {
    // IP literal công khai: checkUrl bỏ qua tra DNS (test không cần mạng).
    const res = await S.safeFetch("https://8.8.8.8/big", { maxBytes: 1024 * 1024 }); // trần 1MB cho test nhanh
    let err = null, total = 0;
    try { const reader = res.body.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; } }
    catch (e) { err = e; }
    ok(err instanceof S.FetchBlocked, "đọc quá trần → FetchBlocked", err && err.constructor.name);
    ok(total <= 1024 * 1024 + 64 * 1024, "dừng đọc gần mốc trần", total);
  } finally { globalThis.fetch = realFetch; }

  console.log("5. maxBytes: 0 bỏ trần (luồng SSE dài)");
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(200)); c.close(); } }), { status: 200 });
  try {
    const res = await S.safeFetch("https://1.1.1.1/sse", { maxBytes: 0 });
    const buf = await res.arrayBuffer();
    ok(buf.byteLength === 200, "không bọc trần khi maxBytes 0", buf.byteLength);
  } finally { globalThis.fetch = realFetch; }
} catch (e) {
  fail++; console.error("  ✗ lỗi", e);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
