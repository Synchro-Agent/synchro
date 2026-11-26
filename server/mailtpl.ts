// Mẫu email của Synchro (hàm thuần, có kiểm thử ở tests/api/forgot.test.mjs). Email chạy trong rất nhiều trình đọc thư khác nhau nên chỉ dùng bảng và
// style nằm ngay trên thẻ: Gmail bỏ phần lớn <style>, Outlook vẽ bằng Word. Logo là ảnh PNG, trình đọc thư không hiện SVG. Giữ nền sáng ở mọi chế độ:
// tự đảo màu làm logo và nút tối biến mất trên nền tối.
import "server-only";
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

/** Xác minh email khi đăng ký. days: thời hạn của đường dẫn. */
export function verifyMail(o: { base: string; name?: string | null; url: string; days: number; lang: MailLang }): Mail {
  const vi = o.lang === "vi", name = o.name?.trim() ? esc(o.name.trim()) : "";
  const title = vi ? "Xác minh email của bạn" : "Verify your email";
  const lead = vi ? `Chào${name ? ` ${name}` : " bạn"}, có người vừa tạo tài khoản Synchro bằng địa chỉ này. Nếu là bạn, hãy xác minh để dùng tệp đính kèm, connector, Autopilot và Synchro Code.` : `Hi${name ? ` ${name}` : ""}, someone just created a Synchro account with this address. If it was you, verify it to use file attachments, connectors, Autopilot and Synchro Code.`;
  const after = vi ? `Đường dẫn có hiệu lực trong <b style="color:${INK};font-weight:600">${o.days} ngày</b>.` : `This link works for <b style="color:${INK};font-weight:600">${o.days} days</b>.`;
  const note = vi ? "Không phải bạn đăng ký? Mở đường dẫn rồi chọn \"Không phải tôi\" để xóa tài khoản đó, hoặc bỏ qua email này." : "Didn't sign up? Open the link and choose \"This wasn't me\" to remove that account, or ignore this email.";
  const label = vi ? "Xác minh email" : "Verify email";
  const fallback = vi ? "Nút không bấm được? Dán đường dẫn này vào trình duyệt:" : "Button not working? Paste this link into your browser:";
  return {
    subject: vi ? "Xác minh email cho tài khoản Synchro" : "Verify your email for Synchro",
    html: frame(o.base, o.lang, { pre: vi ? "Một bước nữa để dùng đủ tính năng của Synchro." : "One more step to use all of Synchro.", title, lead, cta: { label, url: o.url }, after, note, fallback: { label: fallback, url: o.url } }),
    text: vi
      ? `${title}\n\nCó người vừa tạo tài khoản Synchro bằng địa chỉ này. Nếu là bạn, mở đường dẫn này để xác minh (hiệu lực ${o.days} ngày):\n${o.url}\n\nKhông phải bạn đăng ký? Mở đường dẫn rồi chọn "Không phải tôi" để xóa tài khoản đó, hoặc bỏ qua email này.\n\nSynchro`
      : `${title}\n\nSomeone just created a Synchro account with this address. If it was you, open this link to verify it (works for ${o.days} days):\n${o.url}\n\nDidn't sign up? Open the link and choose "This wasn't me" to remove that account, or ignore this email.\n\nSynchro`,
  };
}

/** Có người đăng ký bằng email đã có tài khoản: chủ email được báo và có đường lấy lại. Trang đăng ký không nói gì về chuyện này. */
/** Đổi email: đường dẫn xác nhận gửi tới địa chỉ mới. Email chỉ đổi khi người dùng bấm. */
export function emailChangeMail(o: { base: string; name?: string | null; url: string; hours: number; lang: MailLang }): Mail {
  const vi = o.lang === "vi", name = o.name?.trim() ? esc(o.name.trim()) : "";
  const title = vi ? "Xác nhận email mới" : "Confirm your new email";
  const lead = vi ? `Chào${name ? ` ${name}` : " bạn"}, tài khoản Synchro vừa yêu cầu đổi sang địa chỉ này. Bấm nút bên dưới để xác nhận.` : `Hi${name ? ` ${name}` : ""}, a Synchro account asked to switch to this address. Press the button below to confirm.`;
  const after = vi ? `Đường dẫn có hiệu lực trong <b style="color:${INK};font-weight:600">${o.hours} giờ</b>.` : `This link works for <b style="color:${INK};font-weight:600">${o.hours} hours</b>.`;
  const note = vi ? "Không phải bạn yêu cầu? Hãy bỏ qua email này, sẽ không có gì thay đổi." : "Didn't ask for this? Ignore this email and nothing changes.";
  const label = vi ? "Xác nhận email mới" : "Confirm new email";
  const fallback = vi ? "Nút không bấm được? Dán đường dẫn này vào trình duyệt:" : "Button not working? Paste this link into your browser:";
  return {
    subject: vi ? "Xác nhận email mới cho tài khoản Synchro" : "Confirm your new email for Synchro",
    html: frame(o.base, o.lang, { pre: lead.slice(0, 80), title, lead, cta: { label, url: o.url }, after, note, fallback: { label: fallback, url: o.url } }),
    text: `${title}\n\n${vi ? "Mở đường dẫn này để xác nhận" : "Open this link to confirm"} (${o.hours} ${vi ? "giờ" : "hours"}):\n${o.url}\n\n${note}`,
  };
}
/** Báo cho địa chỉ cũ, để chủ thật biết nếu tài khoản bị người khác đổi email. */
export function emailChangeNoticeMail(o: { base: string; name?: string | null; to: string; lang: MailLang }): Mail {
  const vi = o.lang === "vi", name = o.name?.trim() ? esc(o.name.trim()) : "", url = `${o.base}/reset`;
  const title = vi ? "Có yêu cầu đổi email tài khoản" : "A change of email was requested";
  const lead = vi ? `Chào${name ? ` ${name}` : " bạn"}, tài khoản Synchro của bạn vừa yêu cầu đổi email sang <b style="color:${INK};font-weight:600">${esc(o.to)}</b>. Email chỉ đổi sau khi địa chỉ mới xác nhận.` : `Hi${name ? ` ${name}` : ""}, your Synchro account asked to change its email to <b style="color:${INK};font-weight:600">${esc(o.to)}</b>. It only changes once the new address confirms.`;
  const note = vi ? "Không phải bạn? Hãy đặt lại mật khẩu ngay." : "Wasn't you? Reset your password right away.";
  const label = vi ? "Đặt lại mật khẩu" : "Reset password";
  const fallback = vi ? "Nút không bấm được? Dán đường dẫn này vào trình duyệt:" : "Button not working? Paste this link into your browser:";
  return {
    subject: vi ? "Có yêu cầu đổi email tài khoản Synchro" : "A change of email was requested on your Synchro account",
    html: frame(o.base, o.lang, { pre: note, title, lead, cta: { label, url }, note, fallback: { label: fallback, url } }),
    text: `${title}\n\n${vi ? `Email mới: ${o.to}` : `New email: ${o.to}`}\n\n${note}\n${url}`,
  };
}

export function signupTakenMail(o: { base: string; url: string; lang: MailLang }): Mail {
  const vi = o.lang === "vi";
  const title = vi ? "Email này đã có tài khoản Synchro" : "This email already has a Synchro account";
  const lead = vi ? "Có người (có thể là bạn) vừa thử tạo tài khoản Synchro mới bằng địa chỉ này. Không có tài khoản mới nào được tạo." : "Someone (maybe you) just tried to create a new Synchro account with this address. No new account was created.";
  const after = vi ? "Nếu là bạn, hãy đăng nhập, hoặc đặt lại mật khẩu nếu đã quên. Bạn dùng Google, GitHub hay Apple thì đăng nhập bằng nút đó." : "If it was you, sign in, or reset your password if you've forgotten it. If you use Google, GitHub or Apple, sign in with that button.";
  const note = vi ? "Không phải bạn và chưa từng đăng ký Synchro? Đặt lại mật khẩu sẽ giành lại tài khoản: phiên của người khác bị đăng xuất và phần họ đã cài đặt bị xóa." : "Not you, and you never signed up for Synchro? Resetting the password takes the account back: other sessions are signed out and anything they set up is removed.";
  const label = vi ? "Đặt lại mật khẩu" : "Reset password";
  return {
    subject: title,
    html: frame(o.base, o.lang, { pre: lead, title, lead, after, note, cta: { label, url: o.url } }),
    text: `${title}\n\n${lead}\n\n${after}\n\n${label}: ${o.url}\n\n${note}\n\nSynchro`,
  };
}

/** Thư thử do quản trị viên gửi từ trang sức khỏe. */
export function testMail(o: { base: string; lang: MailLang; when: string }): Mail {
  const vi = o.lang === "vi";
  const title = vi ? "Thư thử của Synchro" : "Synchro test email";
  const lead = vi ? `Thư này được gửi thử từ Cài đặt → Sức khỏe hệ thống lúc <b style="color:${INK};font-weight:600">${esc(o.when)}</b>. Bạn đọc được dòng này nghĩa là email của Synchro tới được hộp thư này.` : `This test was sent from Settings → System health at <b style="color:${INK};font-weight:600">${esc(o.when)}</b>. If you can read this, Synchro's email reaches this inbox.`;
  const note = vi ? "Hãy xem thư này nằm ở hộp thư chính hay Spam, và kiểm tra chữ ký DKIM trong phần xem thư gốc." : "Check whether this landed in your main inbox or Spam, and look for the DKIM signature in the original message view.";
  return { subject: title, html: frame(o.base, o.lang, { pre: title, title, lead, note }), text: `${title}\n\n${vi ? "Gửi thử lúc" : "Sent at"} ${o.when}.\n\nSynchro` };
}

/** Cảnh báo vận hành gửi cho quản trị viên. */
export function opsAlertMail(o: { base: string; title: string; text: string; titleEn: string; textEn: string }): Mail {
  const url = `${o.base}/`;
  return {
    subject: `[Synchro] ${o.title} / ${o.titleEn}`,
    html: frame(o.base, "vi", { pre: o.title, title: o.title, lead: `${esc(o.text)}<br><br>${esc(o.titleEn)}: ${esc(o.textEn)}`, cta: { label: "Mở Synchro / Open Synchro", url }, note: "Xem chi tiết ở Cài đặt → Sức khỏe hệ thống. Mỗi loại cảnh báo gửi tối đa một lần mỗi ngày. / See Settings → System health. Each kind of alert is sent at most once a day." }),
    text: `${o.title}\n\n${o.text}\n\n${o.titleEn}\n\n${o.textEn}\n\nCài đặt → Sức khỏe hệ thống / Settings → System health: ${url}\n\nSynchro`,
  };
}

type AutopilotMailIn = {
  base: string; lang: MailLang; title: string; when: string; ok: boolean; summary: string; url: string;
};
/** Autopilot vừa chạy xong một việc (người dùng bật "Gửi email khi xong" cho việc đó): tóm tắt kết quả và nút mở đoạn
 *  chat để hỏi tiếp. ok = false: lần chạy lỗi, phần tóm tắt là lý do. */
export function autopilotMail(o: AutopilotMailIn): Mail {
  const vi = o.lang === "vi";
  const subject = o.ok
    ? (vi ? `Autopilot đã xong: ${o.title}` : `Autopilot finished: ${o.title}`)
    : (vi ? `Autopilot gặp lỗi: ${o.title}` : `Autopilot hit an error: ${o.title}`);
  const at = `<b style="color:${INK};font-weight:600">${esc(o.when)}</b>`;
  const lead = o.ok
    ? (vi ? `Synchro đã chạy xong việc này lúc ${at}. Kết quả nằm trong một đoạn chat để bạn đọc đầy đủ và hỏi tiếp.`
      : `Synchro finished this task at ${at}. The result is in a chat you can open to read in full and follow up.`)
    : (vi ? `Lần chạy lúc ${at} chưa xong. Mở Autopilot để xem chi tiết hoặc bấm Chạy lại.`
      : `The run at ${at} didn't finish. Open Autopilot to see the details or run it again.`);
  const label = o.ok ? (vi ? "Mở đoạn chat" : "Open the chat") : (vi ? "Mở Autopilot" : "Open Autopilot");
  const note = vi
    ? "Bạn nhận email này vì đã bật \"Gửi email khi xong\" cho việc này trong Autopilot. Tắt ở nút Sửa của việc."
    : "You're getting this because \"Email me when done\" is on for this task in Autopilot. Turn it off in Edit.";
  const after = esc(o.summary).replace(/\n/g, "<br>");
  return {
    subject: subject.slice(0, 160),
    html: frame(o.base, o.lang, { pre: o.summary.slice(0, 140), title: o.title, lead, cta: { label, url: o.url }, after,
      note }),
    text: `${o.title}\n\n${o.summary}\n\n${label}: ${o.url}\n\nSynchro`,
  };
}
