"use client";
// Hiệu ứng của trang chủ tách khỏi home.tsx (blueprint B2 bước 8): mở app (gói khởi động / hỏi tài khoản, tự thử lại), phím tắt toàn trang,
// kéo thả tệp. Chuyển nguyên mã, phần của Home (hàm đặt state, ref) truyền vào; thứ tự chạy theo chỗ gọi trong Home như trước.
import { useCallback, useEffect, useRef, useState } from "react";
import { inFloating } from "./clickaway";
import { chatFont, usePref } from "./store";
import { prefetchChats } from "./chatsync";
import { loadMe, watchSession } from "./session";
import { installTips } from "./tips";
import { installFloatFit } from "./floatfit";
import { installA11y } from "./a11y";
import { saveBlob } from "./filemenu";
import { capFiles } from "./filestate";
import { useSideUi } from "./chatstore.client";
import type { AuthUser, Providers } from "./auth";
import type { BootData } from "../server/bootdata";

export type MeReply = { user: AuthUser | null; providers: Providers; signupOpen?: boolean; speechReady?: boolean };
type SetState<T> = (v: T | ((o: T) => T)) => void;

/** Lúc hydrate: đã biết tài khoản thì hỏi đoạn chat mới song song (chatsync.ts prefetchChats); áp cài đặt hiển thị lên <html>;
 *  gắn gợi ý, khung nổi trong màn hình, khả năng truy cập (một lần cho cả trang). */
export function usePageSetup(boot: BootData | null | undefined) {
  useState(() => { if (boot?.user && typeof window !== "undefined") prefetchChats(boot.user.id); return 0; });
  const [size] = usePref("size", "Medium");
  const [font] = usePref("font", "Default");
  const [uiFont] = usePref("uiFont", "Default");
  const [width] = usePref("width", "Narrow");
  const [motion] = usePref("motion", "System");
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.motion = motion === "Reduced" ? "reduced" : "";
    r.dataset.chatFont = chatFont(font);
    r.dataset.uiFont = uiFont;
    r.dataset.textSize = size;
    // Mặc định bằng cột chat của Claude (48rem = 768px); Vừa / Rộng cho màn hình lớn.
    r.style.setProperty("--thread-w", { Narrow: "768px", Medium: "880px", Wide: "1040px" }[width] ?? "768px");
  }, [motion, font, uiFont, size, width]);
  // Gợi ý khi rê chuột tự lật xuống dưới / canh theo mép khi sát mép màn hình hay mép khung (tips.ts).
  useEffect(() => installTips(), []);
  useEffect(() => installFloatFit(), []);
  useEffect(() => installA11y(), []);
}

/** Mở app: gói dựng sẵn ở máy chủ (app/page.tsx, blueprint A3) dùng một lần, không có thì hỏi /api/auth/me. Không hỏi được máy chủ (mất mạng,
 *  máy chủ đang khởi động lại) không có nghĩa là đã đăng xuất: người đã đăng nhập thấy "không kết nối được" (bootErr) kèm tự thử lại sau 5 giây
 *  và khi có mạng lại; chỉ khi máy chủ trả lời rõ { user: null } mới coi là chưa đăng nhập (apply nhận câu trả lời đó).
 *  Phiên hết hạn khi app đang mở: expired (màn hình đăng nhập phủ lên trên, bên dưới giữ nguyên). */
export function useBoot(o: { boot: BootData | null; apply: (j: MeReply, b?: BootData) => void; setMe: SetState<AuthUser | null | undefined>; me: AuthUser | null | undefined }) {
  const [bootErr, setBootErr] = useState(false);
  const bootRetry = useRef<() => void>(() => {});
  const live = useRef(o);
  live.current = o;
  useEffect(() => {
    localStorage.removeItem("session"); // phiên giả lập cũ, nay dùng cookie máy chủ
    let dead = false, t: ReturnType<typeof setTimeout> | undefined;
    const apply = (j: MeReply, b?: BootData) => {
      bootRetry.current = () => {};
      setBootErr(false);
      live.current.apply(j, b);
    };
    const go = (tries?: number) => {
      clearTimeout(t);
      // Lần đầu: gói dựng sẵn ở máy chủ, không hỏi gì thêm. Không có gói (khách chưa đăng nhập, máy chủ dựng lỗi) hay lần thử lại: hỏi /api/auth/me như trước.
      const b = tries === undefined ? live.current.boot : null;
      if (b) { apply(b, b); return; }
      loadMe<MeReply>(tries).then((j) => {
        if (dead) return;
        apply(j);
      }).catch(() => {
        if (dead) return;
        let was = false;
        try { was = !!localStorage.getItem("signedIn"); } catch {}
        if (was) setBootErr(true); else live.current.setMe((m) => (m === undefined ? null : m));
        t = setTimeout(() => go(0), 5000);
      });
    };
    bootRetry.current = () => go(0);
    const online = () => bootRetry.current();
    window.addEventListener("online", online);
    go();
    return () => { dead = true; clearTimeout(t); window.removeEventListener("online", online); };
  }, []);
  // Phiên hết hạn khi app đang mở: phủ màn hình đăng nhập lên trên, bên dưới giữ nguyên (đoạn chat đang mở, phần đang gõ, lượt đang chạy); đăng nhập lại là dùng tiếp.
  const [expired, setExpired] = useState(false);
  const signedIn = useRef(false);
  signedIn.current = !!o.me;
  useEffect(() => watchSession(() => { if (signedIn.current) setExpired(true); }), []);
  useEffect(() => { try { if (o.me) localStorage.setItem("signedIn", "1"); else if (o.me === null) localStorage.removeItem("signedIn"); } catch {} }, [o.me]);
  return { bootErr, retry: () => bootRetry.current(), expired, setExpired };
}

/** Phím tắt toàn trang: Esc đóng lớp trên cùng (hộp thoại, menu, ngăn kéo ở màn hẹp), ⌘K bảng lệnh (giữ các phím gõ ngay sau ⌘K tới khi ô tìm
 *  có focus: palSeed), ⇧⌘O đoạn chat mới, ⌘. thanh bên, ⌘/ phím tắt, ⇧⌘, Cài đặt. Bấm chuột ra ngoài thì đóng menu tài khoản và menu thanh bên. */
export function useShortcuts(o: {
  searchOpen: boolean; isOpen: () => boolean; narrow: () => boolean; setOpen: SetState<boolean>; goNew: () => void;
  openSearch: () => void; openKeys: () => void; openSettings: () => void; escape: () => void; userRef: React.RefObject<HTMLDivElement | null>; closeUserMenu: () => void;
}) {
  const live = useRef(o);
  live.current = o;
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement, x = live.current;
      if (inFloating(t)) return;
      if (x.userRef.current && !x.userRef.current.contains(t)) x.closeUserMenu();
      const ui = useSideUi.getState();
      if (!t.closest(".chat-wrap")) { ui.setChatMenu(null); ui.setCodeMenu(null); ui.setPickProj(false); if (!t.closest(".title-wrap")) ui.setPickTag(false); }
      if (!t.closest(".title-wrap")) ui.setTitleMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // ⌘K mở bảng lệnh tải lazy: ô tìm chỉ nhận focus sau khi phần mềm của bảng tải xong, nên các phím gõ ngay sau ⌘K bị rơi.
  // Giữ các phím đó lại từ lúc bấm ⌘K cho tới khi ô tìm có focus rồi chèn vào (bảng lệnh gọi palSeed khi đã gắn — tháo đúng lúc đó,
  // không theo một khoảng thời gian cố định có thể hết trước khi chunk lazy tải xong trên máy chậm).
  const palBuf = useRef("");
  const palArmed = useRef(false);
  const palSeed = useCallback(() => { const b = palBuf.current; palBuf.current = ""; palArmed.current = false; return b; }, []);
  // Đóng bảng lệnh bằng bất kỳ đường nào thì ngừng giữ phím (tránh giữ nhầm phím khi người dùng làm việc khác).
  useEffect(() => { if (!o.searchOpen) palArmed.current = false; }, [o.searchOpen]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector(".app[inert]")) return;
      const x = live.current;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      // Đang giữ phím cho bảng lệnh và ô tìm chưa nhận focus: gom ký tự in được vào bộ đệm, chặn để không rơi vào trang.
      if (palArmed.current && !mod && !e.altKey && e.key.length === 1) {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest(".pal")) { palBuf.current += e.key; e.preventDefault(); return; }
        palArmed.current = false; // ô tìm đã có focus: tự nó nhận phím từ đây
      }
      if (e.key === "Escape") {
        // Đóng lớp phủ nằm trên cùng (z-index cao nhất; bằng nhau thì lớp sau): hộp gắn vào cuối <body> (createPortal) đứng sau hộp xác nhận
        // trong DOM dù hộp xác nhận nằm trên nó.
        const ov = [...document.querySelectorAll(".overlay")].filter((o) => !o.closest(".closing"));
        const z = (o: Element) => Number(getComputedStyle(o).zIndex) || 0;
        if (ov.length) ov.reduce((a, o) => (z(o) >= z(a) ? o : a)).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        if (ov.length > 1) return;
        // Màn hẹp (≤ 860px): bảng đoạn chat nổi / ngăn kéo điện thoại nằm trên lớp phủ tối như một hộp thoại, Esc đóng nó khi không còn lớp nào
        // trên nó (menu đã tự đóng ở a11y.ts, hộp thoại ở trên). Đang gõ trong bảng (đổi tên, tìm) thì Esc là của ô đó. Tiêu điểm về nút đã mở bảng.
        const tgt = e.target as HTMLElement | null;
        if (!ov.length && x.isOpen() && x.narrow() && !tgt?.closest?.(".shell-side :is(input,textarea,select,[contenteditable=true])")) {
          const inSide = !!document.activeElement?.closest(".shell-side") || document.activeElement === document.body;
          x.setOpen(false);
          if (inSide) requestAnimationFrame(() => document.querySelector<HTMLElement>(window.matchMedia("(max-width: 760px)").matches ? ".side-toggle" : ".rail-mark")?.focus({ preventScroll: true }));
        }
        x.escape(); useSideUi.getState().closeMenus(); }
      else if (mod && k === "k") { e.preventDefault(); palBuf.current = ""; palArmed.current = true; x.openSearch(); }
      else if (mod && e.shiftKey && k === "o") { e.preventDefault(); x.goNew(); }
      else if (mod && k === ".") { e.preventDefault(); x.setOpen((v) => !v); }
      else if (mod && k === "/") { e.preventDefault(); x.openKeys(); }
      else if (mod && e.shiftKey && k === ",") { e.preventDefault(); x.openSettings(); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  return palSeed;
}

/** Kéo thả tệp vào bất cứ đâu trên trang: hiện lớp "Thả tệp vào đây", thả thì thêm vào ô soạn tin (trừ khi đang ở trình chỉnh ảnh đại diện). */
export function useDragDrop(say: (m: string) => void, setFiles: SetState<string[]>, closeUpload: () => void) {
  const [drag, setDrag] = useState(false);
  const live = useRef({ setFiles, closeUpload });
  live.current = { setFiles, closeUpload };
  useEffect(() => {
    let n = 0;
    const over = (e: DragEvent) => { if (document.querySelector("[data-av]")) return; if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); n++; setDrag(true); } };
    const leave = () => { n = Math.max(0, n - 1); if (!n) setDrag(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); n = 0; setDrag(false);
      if (document.querySelector("[data-av]")) return;
      const fl = Array.from(e.dataTransfer?.files ?? []); fl.forEach((x) => saveBlob(x.name, x, say)); const f = fl.map((x) => x.name);
      if (f.length) { live.current.setFiles((o) => capFiles(o, f, say)); live.current.closeUpload(); say(`Đã thêm ${f.length} tệp`); }
    };
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragenter", over); window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop); window.addEventListener("dragover", prevent);
    return () => { window.removeEventListener("dragenter", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("dragover", prevent); };
  }, [say]);
  return drag;
}
