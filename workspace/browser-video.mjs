// Nén màn hình trình duyệt của Synchro thành video (thay cho từng ảnh JPEG riêng lẻ): khung chỉ mang phần đã đổi so với khung trước,
// nên gõ phím / rê chuột chỉ tốn ~1 KB, cuộn trang ~5–20 KB mà vẫn ở mật độ 2x (chữ nét), trong khi một ảnh JPEG 2x tốn 150–300 KB.
// Hai bộ nén, cùng một cách dùng:
// - ffmpeg (x264, H.264) trên máy chạy dịch vụ workspace (VPS): nhanh nhất (~20 ms một khung 2x), không tốn CPU của container;
// - ngay trong Chromium (WebCodecs, VP9 chế độ nội dung màn hình): khi máy không có ffmpeg (dev:mock trên máy của bạn).
// Người xem giải mã bằng WebCodecs (VideoDecoder); trình duyệt không giải mã được thì máy chủ quay về JPEG như cũ.
//
// Bộ nén (enc): enc.push(jpeg Buffer) — mỗi khung vào ra đúng một khung; enc.close(). w, h: cỡ khung video cố định (điểm ảnh, ở mật độ
// đầy đủ); ảnh nhỏ hơn (Chrome chụp 1,5x khi đang cuộn cho nhanh) được phóng lên đúng cỡ đó, không phải mở lại bộ nén.
// Gọi lại: onConfig({ codec, desc? }) trước khung đầu, onFrame({ key, data }), onError(lỗi) — sau lỗi bộ nén không dùng tiếp.
import { execFile, spawn } from "node:child_process";

// Kích thước ảnh JPEG đọc từ đoạn SOF (không cần thư viện ảnh).
export function jpegSize(b) {
  if (!b || b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}

// SYNCHRO_VIDEO: off = chỉ JPEG; page = chỉ bộ nén trong Chromium; mặc định ffmpeg nếu có, không thì bộ nén trong Chromium (khi host cho).
const MODE = () => process.env.SYNCHRO_VIDEO ?? "";
let ffFound = null;
/** Đường dẫn ffmpeg có libx264, hoặc null. */
export function ffmpegBin() {
  if (MODE() === "off" || MODE() === "page") return Promise.resolve(null);
  return (ffFound ??= new Promise((res) => {
    const bin = process.env.SYNCHRO_FFMPEG || "ffmpeg";
    execFile(bin, ["-hide_banner", "-encoders"], { timeout: 10_000, maxBuffer: 4 << 20 }, (err, out) => res(!err && /libx264/.test(String(out)) ? bin : null));
  }));
}
export const videoOff = () => MODE() === "off";

const hex2 = (n) => n.toString(16).padStart(2, "0");

// ---------------------------------------------------------------- ffmpeg (x264)
// Vào: từng ảnh JPEG trong luồng multipart (mpjpeg, có Content-Length nên ffmpeg trả khung ngay, không chờ khung sau).
// Ra: FLV — mỗi khung một thẻ có độ dài, đọc được ngay khi đủ byte; thẻ đầu là cấu hình AVC (avcC) dùng làm description cho VideoDecoder.
// x264 superfast + zerolatency: không khung B, không nhìn trước; CRF giữ chất lượng đều. Màu: ma trận BT.601 của JPEG, dải TV.
// Không thêm -probesize nhỏ / -fflags nobuffer: với mpjpeg hai cờ này làm ffmpeg giữ lại một khung (đo trên VPS: trễ đúng một nhịp).
export function ffmpegEncoder(bin, { crf = 24, w, h } = {}) {
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const args = ["-hide_banner", "-loglevel", "error", "-f", "mpjpeg", "-i", "pipe:0", "-an",
    "-vf", w && h ? `scale=${even(w)}:${even(h)}:flags=bicubic,format=yuv420p` : "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,format=yuv420p",
    "-c:v", "libx264", "-preset", "superfast", "-tune", "zerolatency", "-crf", String(crf), "-g", "100000", "-bf", "0",
    "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "smpte170m", "-color_range", "tv",
    "-fps_mode", "passthrough", "-flush_packets", "1", "-f", "flv", "-flvflags", "no_duration_filesize", "pipe:1"];
  // Dịch vụ workspace chạy bằng root: ffmpeg chỉ đọc / ghi qua ống, chạy bằng người dùng không có quyền (nobody).
  const opt = { stdio: ["pipe", "pipe", "pipe"], ...(process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {}) };
  const enc = { kind: "ffmpeg", onConfig: null, onFrame: null, onError: null, push: null, close: null };
  let closed = false, err = "", buf = Buffer.alloc(0), hdr = false;
  const fail = (m) => { if (closed) return; closed = true; try { p.kill("SIGKILL"); } catch {} enc.onError?.(m); };
  const p = spawn(bin, args, opt);
  p.on("error", (e) => fail(`ffmpeg: ${e.message}`));
  p.on("exit", (code) => fail(`ffmpeg dừng (${code}) ${err.trim().split("\n").slice(-2).join(" ")}`.trim()));
  p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  p.stdin.on("error", () => {});
  p.stdout.on("data", (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    if (!hdr) { if (buf.length < 13) return; buf = buf.subarray(13); hdr = true; }
    while (buf.length >= 11) {
      const type = buf[0], size = buf.readUIntBE(1, 3);
      if (buf.length < 15 + size) break;
      const data = buf.subarray(11, 11 + size);
      buf = buf.subarray(15 + size);
      if (closed || type !== 9 || size < 5 || (data[0] & 0x0f) !== 7) continue;
      if (data[1] === 0) {
        const desc = Buffer.from(data.subarray(5));
        enc.onConfig?.({ codec: `avc1.${hex2(desc[1])}${hex2(desc[2])}${hex2(desc[3])}`, desc });
      } else if (data[1] === 1) enc.onFrame?.({ key: data[0] >> 4 === 1, data: Buffer.from(data.subarray(5)) });
    }
  });
  enc.push = (jpg) => { if (!closed) p.stdin.write(Buffer.concat([Buffer.from(`--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from("\r\n")])); };
  enc.close = () => { if (closed) return; closed = true; try { p.stdin.end(); } catch {} setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 300); };
  return enc;
}

// ---------------------------------------------------------------- trong Chromium (WebCodecs)
// Một tab ẩn ở cửa sổ riêng (không đổi tab người dùng đang xem, không hiện trong danh sách tab): trang https giả (trả bằng Fetch,
// không ra mạng) để có ngữ cảnh an toàn — VideoEncoder chỉ có ở đó. Ảnh JPEG giải mã bằng ImageDecoder (ra thẳng I420, nhanh hơn
// ImageBitmap nhiều), nén VP9 thời gian thực, contentHint "text" (chế độ nội dung màn hình: nhận ra trang cuộn, chữ sắc).
export const ENC_URL = "https://encoder.synchro/";
export const ENC_BLANK = "about:blank#synchro-encoder";
export const isEncoderTab = (t) => String(t?.url ?? "").startsWith(ENC_URL) || t?.url === ENC_BLANK;
const VP9 = "vp09.00.50.08";
const PAGE_JS = `window.__venc = (() => {
  const encs = new Map();
  const out = (o) => window.__synchroVideo(JSON.stringify(o));
  const cfg = (w, h) => ({ codec: "${VP9}", width: w, height: h, bitrateMode: "quantizer", latencyMode: "realtime", contentHint: "text", framerate: 30 });
  return {
    async caps() { try { return !!(await VideoEncoder.isConfigSupported(cfg(2000, 1400))).supported && typeof ImageDecoder === "function"; } catch { return false; } },
    open(id, q, tw, th) { encs.set(id, { e: null, w: 0, h: 0, n: 0, q, tw, th }); },
    async frame(id, data) {
      const x = encs.get(id); if (!x) return;
      try {
        const d = new ImageDecoder({ data: Uint8Array.fromBase64(data), type: "image/jpeg" });
        let { image } = await d.decode(); d.close();
        if (!encs.has(id)) { image.close(); return; }
        // Cỡ khung cố định: mọi ảnh đi cùng một đường (bitmap đúng cỡ khung) — ảnh nhỏ hơn lúc đang cuộn được phóng lên; ảnh đủ cỡ cũng
        // đi đường này để hệ màu của mọi khung giống nhau (đổi hệ màu thì bộ nén tự chèn khung khóa kèm cấu hình mới).
        if (x.tw && x.th) {
          const bmp = await createImageBitmap(image, { resizeWidth: x.tw, resizeHeight: x.th, resizeQuality: "medium" });
          const ts = image.timestamp; image.close(); image = new VideoFrame(bmp, { timestamp: ts }); bmp.close();
        }
        const w = image.displayWidth, h = image.displayHeight, first = !x.e;
        if (first) {
          x.e = new VideoEncoder({
            output: (chunk, md) => { const u8 = new Uint8Array(chunk.byteLength); chunk.copyTo(u8); out({ id, k: chunk.type === "key", d: u8.toBase64(), ...(md && md.decoderConfig ? { codec: md.decoderConfig.codec } : {}) }); },
            error: (e) => out({ id, err: String((e && e.message) || e) }),
          });
          x.e.configure(cfg(w, h)); x.w = w; x.h = h;
        }
        const f = new VideoFrame(image, { timestamp: (x.n++) * 33333 });
        image.close();
        x.e.encode(f, { keyFrame: first, vp9: { quantizer: x.q } });
        f.close();
      } catch (e) { out({ id, err: String((e && e.message) || e) }); }
    },
    close(id) { const x = encs.get(id); encs.delete(id); try { x && x.e && x.e.close(); } catch {} },
  };
})();`;

/**
 * Mở trang nén trong trình duyệt. bc: kết nối CDP cấp trình duyệt; connect(targetId) → kết nối CDP tới tab đó.
 * Trả về null nếu Chromium này không nén được (không có VideoEncoder / VP9).
 */
export async function openEncoderPage(bc, connect) {
  const { targetId } = await bc.send("Target.createTarget", { url: ENC_BLANK, newWindow: true, background: true });
  let c;
  try {
    c = await connect(targetId);
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Fetch.enable", { patterns: [{ urlPattern: `${ENC_URL}*`, requestStage: "Request" }] });
    c.on("Fetch.requestPaused", (p) => c.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/html; charset=utf-8" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(`<!doctype html><meta charset="utf-8"><title>Synchro</title><script>${PAGE_JS}</script>`).toString("base64") }).catch(() => {}));
    await c.send("Runtime.addBinding", { name: "__synchroVideo" });
    const loaded = c.once("Page.loadEventFired", 8000);
    await c.send("Page.navigate", { url: ENC_URL });
    await loaded;
    const r = await c.send("Runtime.evaluate", { expression: "window.__venc ? window.__venc.caps() : false", awaitPromise: true, returnByValue: true }, 8000);
    if (r?.result?.value !== true) throw new Error("no encoder");
  } catch {
    c?.close();
    await bc.send("Target.closeTarget", { targetId }).catch(() => {});
    return null;
  }
  const subs = new Map(); // id -> enc
  c.on("Runtime.bindingCalled", (p) => {
    if (p.name !== "__synchroVideo") return;
    let o; try { o = JSON.parse(p.payload); } catch { return; }
    const enc = subs.get(o.id);
    if (!enc) return;
    if (o.err) { subs.delete(o.id); enc.onError?.(`VideoEncoder: ${o.err}`); return; }
    if (o.codec) enc.onConfig?.({ codec: o.codec });
    enc.onFrame?.({ key: !!o.k, data: Buffer.from(o.d, "base64") });
  });
  const ev = (expr) => c.send("Runtime.evaluate", { expression: expr }, 10_000);
  let n = 0;
  return {
    id: targetId, cdp: c,
    get closed() { return c.closed; },
    close() { c.close(); bc.send("Target.closeTarget", { targetId }).catch(() => {}); },
    encoder({ q = 30, w = 0, h = 0 } = {}) {
      const id = `e${++n}`;
      const enc = { kind: "page", onConfig: null, onFrame: null, onError: null };
      subs.set(id, enc);
      const fail = (e) => { if (subs.delete(id)) enc.onError?.(String(e?.message ?? e)); };
      ev(`__venc.open(${JSON.stringify(id)}, ${q | 0}, ${Math.round(w) | 0}, ${Math.round(h) | 0})`).catch(fail);
      enc.push = (jpg) => { if (subs.has(id)) ev(`__venc.frame(${JSON.stringify(id)}, ${JSON.stringify(jpg.toString("base64"))})`).catch(fail); };
      enc.close = () => { if (subs.delete(id)) ev(`__venc.close(${JSON.stringify(id)})`).catch(() => {}); };
      return enc;
    },
  };
}
