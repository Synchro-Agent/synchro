// Mẫu email của Synchro (hàm thuần, có kiểm thử ở tests/api/forgot.test.mjs). Email chạy trong rất nhiều trình đọc thư khác nhau nên chỉ dùng bảng và
// style nằm ngay trên thẻ: Gmail bỏ phần lớn <style>, Outlook vẽ bằng Word. Logo là ảnh PNG, trình đọc thư không hiện SVG. Giữ nền sáng ở mọi chế độ:
// tự đảo màu làm logo và nút tối biến mất trên nền tối.
export type MailLang = "vi" | "en";
export type Mail = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const INK = "#111210", MUTED = "#5f5f5a", FAINT = "#8a8a84", LINE = "#e6e5df", PAPER = "#f4f3ef";

type Block = { pre: string; title: string; lead: string; cta?: { label: string; url: string }; after?: string; note: string; fallback?: { label: string; url: string } };

function frame(base: string, lang: MailLang, b: Block) {
  const foot = lang === "vi" ? "Đây là email tự động, vui lòng không trả lời." : "This is an automated email. Please do not reply.";
  const p = (t: string, extra = "") => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${MUTED};${extra}">${t}</p>`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${esc(b.title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${esc(b.pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 4px 24px"><a href="${esc(base)}" style="text-decoration:none"><img src="${esc(base)}/brand/synchro-logo-email.png" width="118" height="22" alt="Synchro" style="display:block;border:0;height:22px;width:118px;color:${INK};font-family:${FONT};font-size:18px;font-weight:600"></a></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:36px 36px 32px">
<h1 style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;letter-spacing:-.01em;color:${INK}">${esc(b.title)}</h1>
${p(b.lead)}
${b.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td bgcolor="${INK}" style="border-radius:999px"><a href="${esc(b.cta.url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(b.cta.label)}</a></td></tr></table>` : ""}
${b.after ? p(b.after) : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0"><tr><td style="border-top:1px solid ${LINE};padding-top:18px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED}">${b.note}</td></tr></table>
${b.fallback ? `<p style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT}">${esc(b.fallback.label)}<br><a href="${esc(b.fallback.url)}" style="color:${MUTED};word-break:break-all">${esc(b.fallback.url)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${FAINT}">Synchro · <a href="${esc(base)}" style="color:${FAINT};text-decoration:underline">${esc(base.replace(/^https?:\/\//, ""))}</a><br>${foot}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Thư đặt lại mật khẩu. minutes: thời hạn của đường dẫn. */
export function resetMail(o: { base: string; name?: string | null; url: string; minutes: number; lang: MailLang }): Mail {
  const vi = o.lang === "vi", name = o.name?.trim() ? esc(o.name.trim()) : "";
  const title = vi ? "Đặt lại mật khẩu" : "Reset your password";
  const subject = vi ? "Đặt lại mật khẩu Synchro" : "Reset your Synchro password";
  const lead = vi ? `Chào${name ? ` ${name}` : " bạn"}, Synchro vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Bấm nút bên dưới để tạo mật khẩu mới.` : `Hi${name ? ` ${name}` : ""}, we received a request to reset the password for your Synchro account. Use the button below to choose a new one.`;
  const after = vi ? `Đường dẫn có hiệu lực trong <b style="color:${INK};font-weight:600">${o.minutes} phút</b> và chỉ dùng được một lần. Sau khi đổi mật khẩu, mọi thiết bị sẽ được đăng xuất.` : `This link works for <b style="color:${INK};font-weight:600">${o.minutes} minutes</b> and can only be used once. Changing your password signs out all your devices.`;
  const note = vi ? "Không phải bạn yêu cầu? Hãy bỏ qua email này, mật khẩu của bạn vẫn giữ nguyên. Đừng chuyển tiếp email này cho ai khác." : "Didn't ask for this? You can ignore this email and your password stays the same. Please don't forward it to anyone.";
  const label = vi ? "Đặt lại mật khẩu" : "Reset password";
  const fallback = vi ? "Nút không bấm được? Dán đường dẫn này vào trình duyệt:" : "Button not working? Paste this link into your browser:";
  return {
    subject,
    html: frame(o.base, o.lang, { pre: vi ? `Đường dẫn có hiệu lực trong ${o.minutes} phút.` : `This link works for ${o.minutes} minutes.`, title, lead, cta: { label, url: o.url }, after, note, fallback: { label: fallback, url: o.url } }),
    text: vi
      ? `${title}\n\nChào${o.name?.trim() ? ` ${o.name.trim()}` : " bạn"}, Synchro vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.\n\nMở đường dẫn này để tạo mật khẩu mới (hiệu lực ${o.minutes} phút, chỉ dùng được một lần):\n${o.url}\n\nKhông phải bạn yêu cầu? Hãy bỏ qua email này, mật khẩu của bạn vẫn giữ nguyên.\n\nSynchro`
      : `${title}\n\nHi${o.name?.trim() ? ` ${o.name.trim()}` : ""}, we received a request to reset the password for your Synchro account.\n\nOpen this link to choose a new one (works for ${o.minutes} minutes, one use only):\n${o.url}\n\nDidn't ask for this? You can ignore this email and your password stays the same.\n\nSynchro`,
  };
}

/** Báo mật khẩu vừa đổi: người bị chiếm tài khoản biết ngay để lấy lại. */
export function changedMail(o: { base: string; name?: string | null; when: string; lang: MailLang }): Mail {
  const vi = o.lang === "vi", name = o.name?.trim() ? esc(o.name.trim()) : "", url = `${o.base}/reset`;
  const title = vi ? "Mật khẩu đã được đổi" : "Your password was changed";
  const lead = vi ? `Chào${name ? ` ${name}` : " bạn"}, mật khẩu tài khoản Synchro của bạn vừa được đổi lúc <b style="color:${INK};font-weight:600">${esc(o.when)}</b>.` : `Hi${name ? ` ${name}` : ""}, the password for your Synchro account was changed at <b style="color:${INK};font-weight:600">${esc(o.when)}</b>.`;
  const note = vi ? "Nếu là bạn thì không cần làm gì thêm. Nếu không phải bạn, hãy đặt lại mật khẩu ngay." : "If this was you, there's nothing else to do. If it wasn't, reset your password now.";
  const label = vi ? "Đặt lại mật khẩu" : "Reset password";
  return {
    subject: vi ? "Mật khẩu Synchro của bạn đã được đổi" : "Your Synchro password was changed",
    html: frame(o.base, o.lang, { pre: vi ? "Thông báo bảo mật cho tài khoản của bạn." : "A security notice about your account.", title, lead, note, cta: { label, url } }),
    text: vi
      ? `${title}\n\nMật khẩu tài khoản Synchro của bạn vừa được đổi lúc ${o.when}.\n\nNếu không phải bạn, hãy đặt lại mật khẩu ngay: ${url}\n\nSynchro`
      : `${title}\n\nThe password for your Synchro account was changed at ${o.when}.\n\nIf this wasn't you, reset your password now: ${url}\n\nSynchro`,
  };
}
