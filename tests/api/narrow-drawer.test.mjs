// LIVE-1: ngưỡng thanh bên dạng ngăn kéo trong CSS phải trùng NARROW của page.tsx. Lệch nhau (CSS 760, JS 860) thì ở 761–860px
// JS đã hiện lớp phủ (z 64) và đóng thanh bên khi bấm, còn CSS để thanh bên nằm trong dòng (z 5) dưới lớp phủ: bấm đoạn chat chỉ trúng lớp phủ.
// Chỉ đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const page = fs.readFileSync("app/home.tsx", "utf8"), ds = fs.readFileSync("app/synchro-ds.css", "utf8"), g = fs.readFileSync("app/globals.css", "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const narrow = Number(page.match(/const NARROW = "\(max-width: (\d+)px\)"/)?.[1]);
ok(narrow > 0, "page.tsx có NARROW", narrow);
// Khối ngăn kéo: .app>.shell-side position:fixed z-index 65.
const drawer = [...strip(ds).matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].find((m) => /\.app>\.shell-side\{position:fixed/.test(m[2]));
ok(drawer && Number(drawer[1]) === narrow, "ngăn kéo thanh bên dùng đúng ngưỡng NARROW", drawer?.[1]);
ok(drawer && /\.app>\.shell-side\{[^}]*z-index:65/.test(drawer[2]), "ngăn kéo nằm trên lớp phủ (z 65 > 64)");
ok(drawer && /\.app>\.shell-side\.closed\{[^}]*transform/.test(drawer[2]), "đóng thì trượt ra ngoài màn hình");
// Mỗi khai báo trong khối ngăn kéo là một quy tắc riêng (không có quy tắc lồng giữa chừng nuốt mất khai báo).
ok(drawer && !/\{[^}]*\{/.test(drawer[2]), "không có quy tắc lồng lạc trong khối ngăn kéo", drawer?.[2].slice(0, 300));
const toggle = strip(ds).match(/@media \(min-width:(\d+)px\)\{html body \.side-toggle\{display:none!important\}\}/);
ok(toggle && Number(toggle[1]) === narrow + 1, "nút logo mở thanh bên hiện ở mọi bề rộng có ngăn kéo", toggle?.[1]);
const scrim = [...strip(g).matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].find((m) => /\.side-scrim\{display:block/.test(m[2]));
ok(scrim && Number(scrim[1]) === narrow, "lớp phủ dùng đúng ngưỡng NARROW", scrim?.[1]);
ok(scrim && /z-index:64/.test(scrim[2]), "lớp phủ z 64, dưới ngăn kéo");
// Màn chờ lúc mở app ẩn thanh trái / thanh bên đúng ngưỡng NARROW: lệch thì iPad dọc (768–834px) thấy khung có thanh trái rồi nhảy sang app không có.
const boot = [...strip(g).matchAll(/@media \(max-width:(\d+)px\)\{([^\n]*)\}/g)].find((m) => /\.boot-rail,\.boot-side\{display:none\}/.test(m[2]));
ok(boot && Number(boot[1]) === narrow, "màn chờ ẩn thanh trái và thanh bên đúng ngưỡng NARROW", boot?.[1]);
ok(!/@media \(max-width:760px\)\{[^\n]*\.boot-rail/.test(strip(g)), "không còn quy tắc 760px nào ẩn thanh trái của màn chờ");
ok(!/\.app>aside\.sidebar/.test(strip(g)),"không còn quy tắc chết .app>aside.sidebar (DOM thật là .app>.shell-side>aside)");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
