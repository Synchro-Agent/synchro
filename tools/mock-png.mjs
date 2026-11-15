// Ảnh PNG một màu (16×16) cho máy chủ giả lập: favicon của nguồn trích dẫn và logo ứng dụng Composio, không cần tệp ảnh hay Internet.
import zlib from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** PNG vuông một màu, màu suy từ chữ (mỗi tên miền / ứng dụng một màu cố định). Kèm khối tEXt để ảnh trên 100 byte: /api/favicon coi ảnh nhỏ hơn là rỗng (iconproxy.ts usableIcon). */
export function solidPng(seed, size = 16) {
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [r, g, b] = [h & 255, (h >> 8) & 255, (h >> 16) & 255].map((v) => 40 + (v % 180));
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(size).fill(row)))), chunk("tEXt", Buffer.from("Software\0Synchro mock favicon", "latin1")), chunk("IEND", Buffer.alloc(0))]);
}
