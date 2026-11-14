// LIVE-1 / U3: dưới NARROW (home.tsx, 860px) bảng đoạn chat đóng sẵn, mở ra là lớp nổi trên lớp phủ tối. CSS phải khớp ngưỡng NARROW của JS:
// lệch nhau (CSS 760, JS 860) thì ở 761–860px JS đã hiện lớp phủ (z 64) và đóng thanh bên khi bấm, còn CSS để thanh bên nằm trong dòng (z 5) dưới
// lớp phủ: bấm đoạn chat chỉ trúng lớp phủ.
// Điện thoại (≤ 760px): thanh điều hướng + bảng đoạn chat là một ngăn kéo. Máy tính bảng dọc (761–860px): thanh điều hướng luôn hiện, chỉ bảng đoạn
// chat nổi (audit.mjs, popovers.mjs và u-bugs.mjs U3 đều đo ở 768px với thanh điều hướng hiện sẵn).
// Chỉ đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const page = fs.readFileSync("app/home.tsx", "utf8"), ds = fs.readFileSync("app/synchro-ds.css", "utf8"), g = fs.readFileSync("app/globals.css", "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const PHONE = 760;

const narrow = Number(page.match(/const NARROW = "\(max-width: (\d+)px\)"/)?.[1]);
ok(narrow > PHONE, "home.tsx có NARROW, rộng hơn ngưỡng điện thoại", narrow);
// Ngăn kéo điện thoại: .app>.shell-side position:fixed z-index 65.
const drawer = [...strip(ds).matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].find((m) => /\.app>\.shell-side\{position:fixed/.test(m[2]));
ok(drawer && Number(drawer[1]) === PHONE, "ngăn kéo (thanh điều hướng + bảng) chỉ ở điện thoại ≤ 760px", drawer?.[1]);
ok(drawer && /\.app>\.shell-side\{[^}]*z-index:65/.test(drawer[2]), "ngăn kéo nằm trên lớp phủ (z 65 > 64)");
ok(drawer && /\.app>\.shell-side\.closed\{[^}]*transform/.test(drawer[2]), "đóng thì trượt ra ngoài màn hình");
ok(drawer && !/\{[^}]*\{/.test(drawer[2]), "không có quy tắc lồng lạc trong khối ngăn kéo", drawer?.[2].slice(0, 300));
// Máy tính bảng dọc: khoảng (PHONE+1)–NARROW, thanh điều hướng trong dòng, bảng đoạn chat nổi trên lớp phủ.
const tab = [...strip(ds).matchAll(/@media \(min-width:(\d+)px\) and \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].find((m) => /\.shell-side \.sidebar\{position:fixed/.test(m[3]));
ok(tab && Number(tab[1]) === PHONE + 1 && Number(tab[2]) === narrow, "761–NARROW: bảng đoạn chat nổi, cùng ngưỡng với JS", tab && `${tab[1]}–${tab[2]}`);
ok(tab && /\.app>\.shell-side:not\(\.closed\)\{z-index:65\}/.test(tab[3]), "bảng mở: thanh điều hướng + bảng nổi nằm trên lớp phủ (z 65)");
ok(tab && !/\.app>\.shell-side\{z-index/.test(tab[3]), "bảng đóng: thanh điều hướng ở z thường (menu của ô soạn tin mở sang trái nằm trên nó)");
ok(tab && /\.sidebar\{position:fixed;[^}]*left:68px/.test(tab[3]), "bảng nổi đứng cạnh thanh điều hướng 68px, không đẩy nội dung");
ok(tab && /\.shell-side\.closed \.sidebar\{[^}]*visibility:hidden/.test(tab[3]), "đóng thì ẩn hẳn (không bấm / Tab được vào bảng đã đóng)");
ok(tab && !/\.app>\.shell-side\{[^}]*position:fixed/.test(tab[3]), "máy tính bảng: thanh điều hướng không thành ngăn kéo");
// Luật ẩn nằm ở lớp syn-over (B5: thắng mọi luật thường của lớp syn mà không cần !important), hoặc còn mang !important.
const dsOver = strip(ds).split("@layer syn-over{")[1] ?? "";
const toggle = dsOver.match(/@media \(min-width:(\d+)px\)\{\s*(?:html body )?\.side-toggle\{display:none\}\s*\}/) ?? strip(ds).match(/@media \(min-width:(\d+)px\)\{\s*html body \.side-toggle\{display:none!important\}\s*\}/);
ok(toggle && Number(toggle[1]) === PHONE + 1, "nút logo ở thanh trên chỉ ở điện thoại (thanh điều hướng có .rail-mark từ 761px)", toggle?.[1]);
const scrim = [...strip(g).matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].find((m) => /\.side-scrim\{display:block/.test(m[2]));
ok(scrim && Number(scrim[1]) === narrow, "lớp phủ dùng đúng ngưỡng NARROW", scrim?.[1]);
ok(scrim && /z-index:64/.test(scrim[2]), "lớp phủ z 64, dưới ngăn kéo / bảng nổi");
// Màn chờ lúc mở app khớp app thật: ≤ NARROW ẩn thanh bên (đóng sẵn), thanh điều hướng chỉ ẩn ở điện thoại.
const bootSide = strip(g).match(/@media \(max-width:(\d+)px\)\{\.boot-side\{display:none\}\}/);
const bootRail = strip(g).match(/@media \(max-width:(\d+)px\)\{\.boot-rail\{display:none\}\}/);
ok(bootSide && Number(bootSide[1]) === narrow, "màn chờ ẩn khối thanh bên đúng ngưỡng NARROW", bootSide?.[1]);
ok(bootRail && Number(bootRail[1]) === PHONE, "màn chờ ẩn thanh điều hướng chỉ ở điện thoại (iPad dọc thấy thanh trái như app thật)", bootRail?.[1]);
ok(!/\.app>aside\.sidebar/.test(strip(g)), "không còn quy tắc chết .app>aside.sidebar (DOM thật là .app>.shell-side>aside)");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
