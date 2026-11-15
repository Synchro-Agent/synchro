"use client";
// Trang tải ứng dụng (/download): Synchro cho macOS, Windows, iPhone và Android.
// Ứng dụng chưa phát hành nên các nút tải chỉ báo "sắp ra mắt"; khi có bản cài đặt, điền đường dẫn vào URL.
import "../styles/download.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import * as I from "../icons";
import { Lockup, Mark } from "../brand";

type Os = "mac" | "win" | "ios" | "android";
const NAME: Record<Os, string> = { mac: "macOS", win: "Windows", ios: "iPhone", android: "Android" };
// Đường dẫn bản cài đặt; để trống khi chưa phát hành.
const URL: Record<Os, string> = { mac: "", win: "", ios: "", android: "" };

// Logo nền tảng: Apple, Android, Google Play từ simple-icons (CC0); Windows là bốn ô vuông.
const Apple = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg>;
const Windows = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M1 1h10.5v10.5H1zM12.5 1H23v10.5H12.5zM1 12.5h10.5V23H1zM12.5 12.5H23V23H12.5z" /></svg>;
const Android = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" /></svg>;
const GooglePlay = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z" /></svg>;
const LOGO: Record<Os, (p: { size?: number }) => React.ReactElement> = { mac: Apple, win: Windows, ios: Apple, android: Android };

function detect(): Os {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/windows/i.test(ua)) return "win";
  return "mac";
}

// Cửa sổ Synchro thu nhỏ (chỉ để minh họa).
function DesktopArt() {
  return (
    <div className="dl-stage" aria-hidden>
      <div className="dl-win">
        <div className="dl-win-bar"><i /><i /><i /></div>
        <div className="dl-win-body">
          <div className="dl-win-side">
            <div className="dl-win-brand"><Lockup height={11} /></div>
            <span className="on"><I.Plus size={11} />Mới</span>
            <span><I.Folder size={11} />Dự án</span>
            <span><I.Code size={11} />Code</span>
            <em>Gần đây</em>
            <span className="r">Lịch trình Đà Lạt 3 ngày</span>
            <span className="r">Tóm tắt báo cáo quý III</span>
            <span className="r">Ý tưởng tên thương hiệu</span>
            <div className="dl-win-user"><b>TN</b>Thử Nghiệm</div>
          </div>
          <div className="dl-win-main">
            <div className="dl-win-hi">Tối rồi, mọi thứ thế nào?</div>
            <div className="dl-win-box">
              <span>Hôm nay tôi có thể giúp gì cho bạn?</span>
              <div><I.Plus size={11} /><small>Claude Opus 5.5</small><b><I.Arrow size={10} /></b></div>
            </div>
          </div>
        </div>
      </div>
      <div className="dl-dock"><i /><i /><span><Mark size={16} /></span><i /><i /></div>
    </div>
  );
}

// Điện thoại thu nhỏ đang trò chuyện (chỉ để minh họa).
function PhoneArt() {
  return (
    <div className="dl-stage dl-stage-phone" aria-hidden>
      <div className="dl-phone">
        <div className="dl-phone-status"><b>9:41</b><span><i /><i /><i /></span></div>
        <div className="dl-phone-head"><I.Back size={14} /><span>Claude Opus 5.5 <I.Chevron size={10} /></span><I.Plus size={14} /></div>
        <div className="dl-phone-chat">
          <div className="u">Gợi ý cho tôi lịch trình 3 ngày ở Đà Lạt</div>
          <div className="a">
            <p><b>Ngày 1:</b> Hồ Xuân Hương, chợ Đà Lạt và đồi chè Cầu Đất lúc hoàng hôn.</p>
            <p><b>Ngày 2:</b> Thung lũng Tình Yêu, cà phê bên hồ Tuyền Lâm.</p>
            <i /><i /><i className="s" />
          </div>
        </div>
        <div className="dl-phone-box"><span>Trả lời Synchro…</span><b><I.Arrow size={10} /></b></div>
      </div>
    </div>
  );
}

export function DownloadView() {
  const [os, setOs] = useState<Os>("mac");
  const [toast, setToast] = useState("");
  useEffect(() => { setOs(detect()); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3200); return () => clearTimeout(t); }, [toast]);
  const get = (o: Os) => { if (URL[o]) window.location.href = URL[o]; else setToast(`Ứng dụng cho ${NAME[o]} đang được phát triển, sẽ sớm ra mắt.`); };
  // Nút chính là máy tính của người xem (máy tính để bàn mặc định macOS), nút còn lại là hệ điều hành kia.
  const main: Os = os === "win" ? "win" : "mac";
  const alt: Os = main === "mac" ? "win" : "mac";
  const Main = LOGO[main], Alt = LOGO[alt];
  const stores: [Os, string, (p: { size?: number }) => React.ReactElement][] = [["ios", "App Store", Apple], ["android", "Google Play", GooglePlay]];
  if (os === "android") stores.reverse();

  return (
    <div className="dl">
      <div className="dl-bg" aria-hidden><i /><i /><i /></div>
      <header className="dl-top">
        <Link href="/" className="dl-brand" aria-label="Synchro"><Lockup height={24} className="lk-hover" /></Link>
        <nav className="dl-nav"><a href="#desktop">Máy tính</a><a href="#mobile">Điện thoại</a></nav>
        <Link href="/" className="btn dark dl-open">Mở Synchro</Link>
      </header>

      <section className="dl-hero" id="desktop">
        <div className="dl-copy">
          <span className="dl-tag">Sắp ra mắt</span>
          <h1>Synchro trên máy tính của bạn</h1>
          <p className="dl-lead">Chưa có bản tải về; hiện bạn dùng Synchro ngay trên trình duyệt. Khi ra mắt, ứng dụng luôn sẵn sàng khi bạn cần: mở Synchro bằng một phím tắt từ bất kỳ đâu, kéo tệp trên máy vào cuộc trò chuyện, không phải chuyển qua lại giữa các tab.</p>
          <div className="dl-btns">
            <button className="dl-main" onClick={() => get(main)}><Main size={19} />{URL[main] ? `Tải cho ${NAME[main]}` : `${NAME[main]}: sắp có`}</button>
            <button className="dl-alt" onClick={() => get(alt)}><Alt size={16} />{URL[alt] ? NAME[alt] : `${NAME[alt]}: sắp có`}</button>
          </div>
          <p className="dl-req">macOS 13 trở lên (Apple Silicon và Intel) · Windows 10 trở lên (x64 và ARM64)</p>
        </div>
        <DesktopArt />
      </section>

      <section className="dl-mobile" id="mobile">
        <PhoneArt />
        <div className="dl-copy">
          <h2>Synchro trong túi bạn</h2>
          <p className="dl-lead">Cuộc trò chuyện đi theo bạn. Bắt đầu trên máy tính, hỏi tiếp trên điện thoại, mọi thứ đều được đồng bộ.</p>
          <div className="dl-stores">
            {stores.map(([o, store, L]) => (
              <button key={o} className="dl-store" onClick={() => get(o)}><L size={22} /><span><small>{URL[o] ? "Tải về trên" : "Sắp có trên"}</small><b>{store}</b></span></button>
            ))}
          </div>
          <p className="dl-req">iOS 17 trở lên · Android 10 trở lên</p>
        </div>
      </section>

      <section className="dl-feats">
        <div><span><I.Keyboard size={18} /></span><b>Gọi nhanh ở mọi nơi</b><p>Nhấn <kbd>⌥</kbd> <kbd>Space</kbd> để hỏi Synchro mà không rời ứng dụng đang dùng.</p></div>
        <div><span><I.Folder size={18} /></span><b>Làm việc với tệp trên máy</b><p>Kéo tài liệu, ảnh và mã nguồn vào cuộc trò chuyện, Synchro đọc ngay tại chỗ.</p></div>
        <div><span><I.Mic size={18} /></span><b>Nói chuyện bằng giọng nói</b><p>Hỏi bằng giọng nói khi đang bận tay, nghe câu trả lời ngay trên máy tính hay điện thoại.</p></div>
      </section>

      <footer className="dl-foot">
        <span>© 2026 Synchro</span>
        <nav><Link href="/privacy">Quyền riêng tư</Link><Link href="/terms">Điều khoản sử dụng</Link><Link href="/">Về trang chủ</Link></nav>
      </footer>

      {toast && <div className="toast dl-toast" role="status"><I.InfoCircle size={15} /><span>{toast}</span></div>}
    </div>
  );
}
