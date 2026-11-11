// Mẫu thư HTML điền sẵn (biên lai, chào mừng / hướng dẫn bắt đầu, mã đăng nhập / thông báo bảo mật, lời mời vào nhóm): dựng thành một thư độc lập
// đọc đúng trên Gmail, Outlook, Apple Mail: bố cục chỉ bằng bảng (role="presentation"), mọi style nội dòng, không <style>, không CSS ngoài, không class, rộng 600px,
// nút "chống vỡ" (ô bảng có bgcolor), dòng xem trước ẩn. Màu theo phong cách của trang (phong cách tối dùng bảng in nền sáng: thư nền tối hay bị ứng dụng thư đảo màu).
// Bố cục dựng lại theo ý các thư mẫu react-email (MIT): apple-receipt, stripe-welcome, linear-login-code, vercel-invite-user; viết mới, không chép mã,
// không dùng tên, logo hay màu thương hiệu của họ. Tệp thuần; designtemplates.ts gắn các mẫu này vào sổ mẫu.
import { FONT_SPEC, presetOf } from "./designpresets";
import { arr, esc, num, obj, str, type Props } from "./tplkit";

type Pal = { bg: string; card: string; ink: string; muted: string; accent: string; line: string; soft: string; font: string; mono: string };
function palette(style: unknown): Pal {
  const p = presetOf(str(style, 40)) ?? presetOf("swiss-grid")!;
  const dark = !!p.print;
  const f = (n: string) => FONT_SPEC[n].stack.replace(/"/g, "'");
  return dark
    ? { bg: "#F4F5F7", card: "#FFFFFF", ink: "#0F172A", muted: "#475569", accent: p.print!.accent!, line: "#E2E8F0", soft: "#F1F5F9", font: f(p.body), mono: f(p.mono) }
    : { bg: p.bg === "#FFFFFF" ? "#F4F5F7" : p.bg, card: "#FFFFFF", ink: p.ink, muted: p.muted, accent: p.accent, line: p.line, soft: p.raised, font: f(p.body), mono: f(p.mono) };
}
const href = (v: unknown) => { const s = str(v, 2000).trim(); return /^https:\/\/[^\s"'<>]+$/i.test(s) || /^mailto:[^\s"'<>]+$/i.test(s) ? s : "#"; };
const txt = (v: unknown, max = 600) => esc(str(v, max)).replace(/\n/g, "<br>");
const T = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;
// Tiền: VND theo cách viết Việt Nam (1.250.000 ₫), tiền khác theo ký hiệu; giá đã là chữ thì giữ nguyên.
export function money(v: unknown, cur = "VND") {
  if (typeof v === "string" && /[^\d.,\s-]/.test(v)) return v;
  const n = num(v), c = cur.toUpperCase();
  if (c === "VND") return `${Math.round(n).toLocaleString("vi-VN")} ₫`;
  try { return n.toLocaleString(c === "EUR" ? "de-DE" : "en-US", { style: "currency", currency: c }); } catch { return `${n.toLocaleString("en-US")} ${c}`; }
}

function shell(p: Props, pal: Pal, title: string, inner: string) {
  const brand = txt(p.brand ?? "Synchro", 60), pre = txt(p.preview ?? title, 160), foot = txt(p.footer ?? `Bạn nhận thư này vì có tài khoản ${str(p.brand ?? "Synchro", 60)}.`, 400);
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${txt(title, 160)}</title></head>
<body style="margin:0;padding:0;background:${pal.bg};-webkit-text-size-adjust:100%">
<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${pre}</span>
<table ${T} width="100%" style="background:${pal.bg}" bgcolor="${pal.bg}"><tr><td align="center" style="padding:32px 12px">
<table ${T} width="600" style="width:100%;max-width:600px">
<tr><td style="padding:0 4px 20px;font-family:${pal.font};font-size:18px;line-height:24px;font-weight:700;color:${pal.ink};letter-spacing:-0.01em">${brand}</td></tr>
<tr><td bgcolor="${pal.card}" style="background:${pal.card};border:1px solid ${pal.line};border-radius:12px;padding:40px 40px 32px;font-family:${pal.font};color:${pal.ink}">
${inner}
</td></tr>
<tr><td style="padding:24px 4px 0;font-family:${pal.font};font-size:12px;line-height:18px;color:${pal.muted}">${foot}${str(p.address) ? `<br>${txt(p.address, 300)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}
const h1 = (pal: Pal, t: unknown) => `<h1 style="margin:0 0 16px;font-family:${pal.font};font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.015em;color:${pal.ink}">${txt(t, 160)}</h1>`;
const para = (pal: Pal, t: unknown, extra = "") => (str(t) ? `<p style="margin:0 0 16px;font-family:${pal.font};font-size:16px;line-height:26px;color:${pal.ink}${extra}">${txt(t, 2000)}</p>` : "");
const small = (pal: Pal, t: unknown) => (str(t) ? `<p style="margin:0 0 12px;font-family:${pal.font};font-size:14px;line-height:22px;color:${pal.muted}">${txt(t, 800)}</p>` : "");
const button = (pal: Pal, label: unknown, url: unknown) => (str(label) ? `<table ${T} style="margin:8px 0 24px"><tr><td bgcolor="${pal.accent}" style="background:${pal.accent};border-radius:8px"><a href="${esc(href(url))}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${pal.font};font-size:15px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">${txt(label, 60)}</a></td></tr></table>` : "");
const rule = (pal: Pal) => `<table ${T} width="100%"><tr><td style="border-top:1px solid ${pal.line};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>`;

export const EMAIL_TEMPLATES: Record<string, (p: Props) => string> = {
  // Biên lai: thông tin đơn (lưới 2 cột), các món, tạm tính / thuế / tổng, cách thanh toán, liên hệ hỗ trợ.
  "email-receipt": (p) => {
    const pal = palette(p._style), cur = str(p.currency, 8) || "VND";
    const items = arr(p.items, 40).map(obj);
    const sub = p.subtotal ?? items.reduce((a, x) => a + num(x.price) * (num(x.qty) || 1), 0), tax = p.tax, total = p.total ?? num(sub) + num(tax);
    const info = [["Mã đơn hàng", p.orderId], ["Ngày", p.date], ["Thanh toán", p.paymentMethod], ["Gửi tới", p.customer]].filter(([, v]) => str(v));
    const cell = (k: unknown, v: unknown) => `<td valign="top" width="50%" style="padding:0 12px 14px 0;font-family:${pal.font}"><span style="display:block;font-size:12px;line-height:18px;color:${pal.muted};text-transform:uppercase;letter-spacing:0.06em">${txt(k, 40)}</span><span style="display:block;font-size:15px;line-height:22px;color:${pal.ink}">${txt(v, 200)}</span></td>`;
    const rows: string[] = []; for (let i = 0; i < info.length; i += 2) rows.push(`<tr>${cell(info[i][0], info[i][1])}${info[i + 1] ? cell(info[i + 1][0], info[i + 1][1]) : "<td></td>"}</tr>`);
    const line = (x: Props) => `<tr><td style="padding:14px 0;border-bottom:1px solid ${pal.line};font-family:${pal.font}"><span style="display:block;font-size:15px;line-height:22px;font-weight:600;color:${pal.ink}">${txt(x.name, 200)}</span>${str(x.detail) ? `<span style="display:block;font-size:13px;line-height:20px;color:${pal.muted}">${txt(x.detail, 200)}</span>` : ""}</td><td align="right" valign="top" style="padding:14px 0 14px 16px;border-bottom:1px solid ${pal.line};font-family:${pal.font};font-size:15px;line-height:22px;color:${pal.ink};white-space:nowrap">${num(x.qty) > 1 ? `${num(x.qty)} × ` : ""}${esc(money(x.price, cur))}</td></tr>`;
    const sum = (k: string, v: unknown, big = false) => `<tr><td style="padding:${big ? "14px" : "6px"} 0 0;font-family:${pal.font};font-size:${big ? 16 : 14}px;line-height:22px;color:${big ? pal.ink : pal.muted};font-weight:${big ? 700 : 400}">${esc(k)}</td><td align="right" style="padding:${big ? "14px" : "6px"} 0 0;font-family:${pal.font};font-size:${big ? 22 : 14}px;line-height:${big ? 28 : 22}px;color:${pal.ink};font-weight:${big ? 700 : 400};white-space:nowrap">${esc(money(v, cur))}</td></tr>`;
    return shell(p, pal, str(p.heading) || "Biên lai", `${h1(pal, p.heading ?? "Biên lai thanh toán")}${small(pal, p.intro ?? "Cảm ơn bạn đã mua hàng. Đây là biên lai cho đơn hàng của bạn.")}
<table ${T} width="100%" style="margin:12px 0 8px">${rows.join("")}</table>${rule(pal)}
<table ${T} width="100%">${items.map(line).join("")}</table>
<table ${T} width="100%" style="margin:8px 0 24px">${sum("Tạm tính", sub)}${tax !== undefined ? sum(str(p.taxLabel) || "Thuế", tax) : ""}${sum("Tổng cộng", total, true)}</table>
${button(pal, p.ctaLabel, p.ctaUrl)}${small(pal, p.note ?? (str(p.supportUrl) ? "" : "Có câu hỏi về đơn hàng? Trả lời thư này để được hỗ trợ."))}${str(p.supportUrl) ? `<p style="margin:0;font-family:${pal.font};font-size:14px;line-height:22px;color:${pal.muted}">Cần hỗ trợ? <a href="${esc(href(p.supportUrl))}" style="color:${pal.accent};text-decoration:underline">Liên hệ chúng tôi</a></p>` : ""}`);
  },
  // Chào mừng và hướng dẫn bắt đầu: lời chào, các bước đánh số, một nút hành động chính, lời ký.
  "email-welcome": (p) => {
    const pal = palette(p._style);
    const steps = arr(p.steps, 6).map(obj).filter((s) => str(s.title) || str(s.text));
    const step = (s: Props, i: number) => `<tr><td valign="top" width="40" style="padding:0 0 18px"><table ${T}><tr><td align="center" width="28" height="28" bgcolor="${pal.soft}" style="width:28px;height:28px;background:${pal.soft};border-radius:14px;font-family:${pal.font};font-size:13px;line-height:28px;font-weight:700;color:${pal.accent}">${i + 1}</td></tr></table></td><td valign="top" style="padding:2px 0 18px;font-family:${pal.font}"><span style="display:block;font-size:16px;line-height:24px;font-weight:600;color:${pal.ink}">${txt(s.title, 120)}</span><span style="display:block;font-size:15px;line-height:24px;color:${pal.muted}">${txt(s.text, 400)}</span></td></tr>`;
    return shell(p, pal, str(p.heading) || "Chào mừng", `${h1(pal, p.heading ?? "Chào mừng bạn")}${para(pal, p.intro)}
${steps.length ? `<table ${T} width="100%" style="margin:8px 0 8px">${steps.map(step).join("")}</table>` : ""}${button(pal, p.ctaLabel, p.ctaUrl)}${para(pal, p.body)}${str(p.signoff) ? `<p style="margin:8px 0 0;font-family:${pal.font};font-size:16px;line-height:26px;color:${pal.ink}">${txt(p.signoff, 200)}</p>` : ""}`);
  },
  // Mã đăng nhập / thông báo bảo mật: tiêu đề ngắn, mã lớn đơn cách trong ô nền nhạt, thời hạn, câu "không phải bạn thì bỏ qua"; có details thì thành bảng thông tin phiên.
  "email-login-code": (p) => {
    const pal = palette(p._style);
    const details = arr(p.details, 8).map(obj).filter((d) => str(d.label));
    const code = str(p.code, 24);
    return shell(p, pal, str(p.heading) || "Mã đăng nhập", `${h1(pal, p.heading ?? "Mã đăng nhập của bạn")}${para(pal, p.intro ?? "Dùng mã dưới đây để đăng nhập. Mã chỉ dùng được một lần.")}
${code ? `<table ${T} width="100%" style="margin:8px 0 20px"><tr><td align="center" bgcolor="${pal.soft}" style="background:${pal.soft};border-radius:8px;padding:20px 12px;font-family:${pal.mono};font-size:32px;line-height:40px;font-weight:700;letter-spacing:0.18em;color:${pal.ink}">${esc(code)}</td></tr></table>` : ""}
${details.length ? `<table ${T} width="100%" style="margin:4px 0 20px">${details.map((d) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${pal.line};font-family:${pal.font};font-size:14px;line-height:20px;color:${pal.muted}" width="40%">${txt(d.label, 60)}</td><td style="padding:8px 0;border-bottom:1px solid ${pal.line};font-family:${pal.font};font-size:14px;line-height:20px;color:${pal.ink}">${txt(d.value, 200)}</td></tr>`).join("")}</table>` : ""}
${button(pal, p.ctaLabel, p.ctaUrl)}${small(pal, p.expires)}${small(pal, p.ignoreNote ?? "Nếu bạn không yêu cầu, hãy bỏ qua thư này: tài khoản của bạn vẫn an toàn.")}`);
  },
  // Lời mời vào nhóm: ai mời, vào nhóm nào, vai trò, nút tham gia, liên kết dự phòng dạng chữ, ghi chú khi không mong đợi lời mời.
  "email-invite": (p) => {
    const pal = palette(p._style);
    const who = `<strong style="color:${pal.ink}">${txt(p.inviter ?? "Một đồng nghiệp", 80)}</strong>${str(p.inviterEmail) ? ` (<a href="mailto:${esc(str(p.inviterEmail, 120))}" style="color:${pal.accent};text-decoration:none">${txt(p.inviterEmail, 120)}</a>)` : ""}`;
    const initials = (s: string) => esc(s.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase() || "?");
    return shell(p, pal, `Lời mời tham gia ${str(p.team, 80)}`, `<table ${T} style="margin:0 0 20px"><tr><td align="center" width="48" height="48" bgcolor="${pal.soft}" style="width:48px;height:48px;background:${pal.soft};border-radius:24px;font-family:${pal.font};font-size:17px;line-height:48px;font-weight:700;color:${pal.accent}">${initials(str(p.inviter, 80))}</td><td style="padding:0 12px;font-family:${pal.font};font-size:20px;line-height:24px;color:${pal.muted}">→</td><td align="center" width="48" height="48" bgcolor="${pal.accent}" style="width:48px;height:48px;background:${pal.accent};border-radius:12px;font-family:${pal.font};font-size:17px;line-height:48px;font-weight:700;color:#FFFFFF">${initials(str(p.team, 80))}</td></tr></table>
${h1(pal, p.heading ?? `Lời mời tham gia ${str(p.team, 80)}`)}<p style="margin:0 0 16px;font-family:${pal.font};font-size:16px;line-height:26px;color:${pal.ink}">${who} đã mời bạn tham gia <strong>${txt(p.team, 80)}</strong>${str(p.role) ? ` với vai trò <strong>${txt(p.role, 40)}</strong>` : ""}.</p>
${button(pal, p.ctaLabel ?? "Tham gia nhóm", p.ctaUrl)}${str(p.ctaUrl) ? `<p style="margin:0 0 16px;font-family:${pal.font};font-size:13px;line-height:20px;color:${pal.muted}">Hoặc mở liên kết: <a href="${esc(href(p.ctaUrl))}" style="color:${pal.accent};word-break:break-all">${esc(href(p.ctaUrl))}</a></p>` : ""}${rule(pal)}<table ${T} width="100%"><tr><td height="16" style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr></table>${small(pal, p.note ?? "Nếu bạn không mong đợi lời mời này, có thể bỏ qua thư.")}`);
  },
};
// Tên khác: mã theo bảng của chủ dự án và vài cách gọi hay gặp.
export const EMAIL_ALIASES: Record<string, string> = {
  "email-apple-receipt": "email-receipt", "email-stripe-welcome": "email-welcome", "email-linear-login-code": "email-login-code", "email-vercel-invite": "email-invite", "email-vercel-invite-user": "email-invite",
  "email-security": "email-login-code", "email-onboarding": "email-welcome", "email-invoice": "email-receipt",
};

export const EMAIL_TPL_GUIDE = `Thư HTML (biên lai, chào mừng, mã đăng nhập, lời mời): dùng mẫu, Synchro dựng thư đúng chuẩn Gmail / Outlook / Apple Mail (chỉ bảng, style nội dòng, rộng 600): trang text/html chỉ gồm <script type="application/json" data-sx-template>{"styleArchetype":"<phong cách>","pages":[{"templateId":"…","props":{…}}]}</script>. Chung: brand, preview (dòng xem trước), footer, address.
email-receipt {heading,intro,orderId,date,customer,paymentMethod,currency ("VND"|"USD"…),items:[{name,detail,qty,price}],tax?,taxLabel?,total? (bỏ thì tự cộng),supportUrl} · email-welcome {heading,intro,steps:[{title,text}],ctaLabel,ctaUrl,body,signoff} · email-login-code {heading,intro,code,expires,ignoreNote; thông báo bảo mật: details:[{label,value}],ctaLabel,ctaUrl} · email-invite {inviter,inviterEmail,team,role,ctaLabel,ctaUrl,note}. Liên kết chỉ https hoặc mailto.`;
