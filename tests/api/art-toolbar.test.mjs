// Thanh công cụ artifact (LIVE-4, LIVE-7): màn cảm ứng 390px không đẩy nút Đóng ra khỏi màn hình; nút xuất bản / Tải về giữ chỗ từ đầu
// nên Chỉ và sửa / Chạy lại / Sao chép không nhảy khi artifact xong. Chỉ đọc mã nguồn, không cần máy chủ.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const ds = fs.readFileSync("app/synchro-ds.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), g = fs.readFileSync("app/globals.css", "utf8"), ui = fs.readFileSync("app/artifactui.tsx", "utf8");

const coarse = ds.match(/@media \(pointer:coarse\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
ok(/min-width:44px;min-height:44px/.test(coarse), "màn cảm ứng: vùng bấm 44px vẫn giữ");
const acts = coarse.match(/html body \.art-acts:not\(\.auth-root \*\)\{([^}]*)\}/)?.[1] ?? "";
ok(/flex-wrap:wrap/.test(acts) && /min-width:0/.test(acts) && /max-width:100%/.test(acts) && /flex:0 1 auto/.test(acts), "thanh công cụ artifact co theo khung và xuống dòng thay vì tràn", acts);
ok(/justify-content:flex-end/.test(acts), "xuống dòng vẫn canh phải");
ok(/\.rp-pw \.icon-btn[^{]*\{min-width:0;min-height:0\}/.test(coarse) && /\.rp-pw \.icon-btn::after\{[^}]*inset:-7px/.test(coarse), "nút hiện mật khẩu không cao hơn ô nhập, vùng bấm bằng lớp giả");
// Nút Đóng là nút cuối của nhóm: xuống dòng thì vẫn ở mép phải, luôn thấy.
const group = ui.match(/<div className="art-acts">([\s\S]*?)\n        <\/div>\n      <\/header>/)?.[1] ?? "";
ok(/aria-label="Đóng"[^\n]*<\/button>\s*$/.test(group), "nút Đóng đứng cuối nhóm", group.slice(-200));
// LIVE-7: không còn nút nào chỉ hiện ra bên phải các nút cố định khi artifact xong.
ok(!/\{art\.complete && (extra|<DownloadMenu)/.test(group), "xuất bản / Tải về không mọc ra lúc artifact xong");
ok(/<span className=\{`art-slot\$\{art\.complete \? "" : " wait"\}`\} inert=\{!art\.complete\}/.test(group), "chỗ giữ sẵn: ẩn và không bấm được khi chưa xong");
ok(/\.art-slot\{display:contents\}/.test(g) && /\.art-slot\.wait\{visibility:hidden\}/.test(g), "chỗ giữ sẵn vẫn chiếm chỗ khi ẩn, khe giữa các nút như cũ");
const order = ["Chỉ và sửa", "Sao chép", "art-slot", "Toàn màn hình", "Đóng"].map((k) => group.indexOf(k));
ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), "thứ tự nút giữ nguyên", order);

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
