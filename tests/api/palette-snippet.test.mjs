// Đoạn trích trong ⌘K (LIVE-9): không lộ thẻ <artifact …>, khối mã, thẻ công cụ hay ký hiệu Markdown. Không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const { runtext: R } = await loadTs(["runtext"]);

const s1 = R.plainSnippet('Lời chào — Mình đã soạn bản kế hoạch, bạn có thể tải về dạng Markdown: <artifact identifier="ke-hoach" type="text/markdown" title="Kế hoạch">\n# Kế hoạch\n- a\n</artifact>\nChúc vui.');
ok(s1 === "Lời chào — Mình đã soạn bản kế hoạch, bạn có thể tải về dạng Markdown: Chúc vui.", "bỏ cả khối artifact", s1);
const s2 = R.plainSnippet("Đang viết <artifact identifier=\"x\" type=\"text/html\">\n<html><body>");
ok(s2 === "Đang viết", "khối artifact chưa đóng (đang viết) cũng bỏ", s2);
const s3 = R.plainSnippet("**Kết quả**: xem [bảng](https://x.y/z) và\n```js\nconst a = 1;\n```\n<tool_call name=\"web\">q</tool_call> xong");
ok(s3 === "Kết quả: xem bảng và q xong", "bỏ khối mã, thẻ công cụ, ký hiệu Markdown, giữ chữ liên kết", s3);
ok(R.plainSnippet("") === "", "chữ rỗng");

const pal = fs.readFileSync("app/palette.tsx", "utf8");
ok(/plainSnippet\(hit\)/.test(pal) && !/hit\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 80\)/.test(pal), "⌘K dùng plainSnippet cho đoạn trích tin nhắn");

// W1-08: tin AI cũ mở đầu bằng dòng "Đã áp dụng hướng dẫn của bạn: “…”" — ⌘K không trích lại hướng dẫn cá nhân, không tìm trúng chữ trong dòng đó;
// chế độ giọng nói không đọc dòng đó.
const { turnctx: T } = await loadTs(["turnctx"]);
const old = "_Đã áp dụng hướng dẫn của bạn: “Tôi là kế toán ở Đà Nẵng, trả lời ngắn”_\n\nBáo cáo quý ba đã xong.";
const shown = T.stripAppliedNotes(old);
ok(R.plainSnippet(shown) === "Báo cáo quý ba đã xong.", "đoạn trích bỏ dòng hướng dẫn cá nhân", R.plainSnippet(shown));
ok(/const shownText = \(o: \{ text\?: string; role\?: string \}\) => \(o\.role === "user" \? o\.text \?\? "" : stripAppliedNotes\(o\.text \?\? ""\)\);/.test(pal), "⌘K lọc dòng ghi chú cũ trên tin AI");
ok(/v = foldRaw\(shownText\(o\)\)/.test(pal), "⌘K tìm trên chữ đã lọc (gõ 'Đà Nẵng' không trúng dòng đã ẩn)");
ok(/const hit = hitMsg && shownText\(hitMsg\);/.test(pal) && /plainSnippet\(hit\)/.test(pal), "đoạn trích lấy chữ đã lọc");
const page = fs.readFileSync("app/home.tsx", "utf8");
ok(/<VoiceMode[^\n]*reply=\{lastAi \? \{ text: lastAi\.failed \? tr\(chatError\(lastAi\.err\)\.text\) : stripAppliedNotes\(lastAi\.text\)/.test(page), "chế độ giọng nói không đọc dòng ghi chú cũ");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
