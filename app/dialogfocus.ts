// Mọi hộp thoại của app (.overlay) cư xử như hộp thoại thật mà không phải sửa từng nơi: role=dialog, aria-modal, tên lấy từ tiêu đề; mở ra thì tiêu điểm vào trong
// (ô nhập đầu tiên, không có thì chính hộp thoại, để gõ phím không rơi xuống ô soạn tin phía sau); Tab chỉ đi vòng trong hộp; phần còn lại inert; đóng thì trả tiêu điểm về chỗ cũ.
// Hộp chồng nhau (xác nhận trên Cài đặt): hộp trên cùng giữ tiêu điểm, đóng thì về hộp dưới.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
const shown = (e: HTMLElement) => e.offsetWidth > 0 || e.offsetHeight > 0 || e.getClientRects().length > 0;
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => shown(e) && !e.closest("[inert]"));
const overlays = () => [...document.querySelectorAll<HTMLElement>(".overlay")].filter((o) => !o.closest(".closing") && !o.classList.contains("closing"));
// Trên cùng: z-index cao nhất, bằng nhau thì sau cùng (cùng cách phím Esc chọn lớp để đóng, page.tsx).
const topOf = (l: HTMLElement[]) => l.reduce<HTMLElement | null>((a, o) => (!a || (Number(getComputedStyle(o).zIndex) || 0) >= (Number(getComputedStyle(a).zIndex) || 0) ? o : a), null);
const boxOf = (o: HTMLElement) => o.querySelector<HTMLElement>(".modal") ?? (o.firstElementChild as HTMLElement | null) ?? o;

let idSeq = 0;
function label(box: HTMLElement) {
  if (!box.getAttribute("role")) box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  if (!box.getAttribute("aria-label") && !box.getAttribute("aria-labelledby")) {
    const h = box.querySelector<HTMLElement>("h1,h2,h3");
    if (h) { h.id ||= `dlg-title-${++idSeq}`; box.setAttribute("aria-labelledby", h.id); }
  }
}

export function installDialogFocus() {
  let top: HTMLElement | null = null;
  // Chỗ tiêu điểm trước khi mở từng hộp, để trả về khi đóng.
  const back = new WeakMap<HTMLElement, HTMLElement | null>();
  let outside: HTMLElement | null = null;
  let walled: HTMLElement[] = [];
  const unwall = () => { for (const e of walled) e.inert = false; walled = []; };
  // Chặn phần còn lại: mọi anh em của hộp, đi dần lên tới body. Thông báo nhanh (toast) vẫn phải đọc được.
  const wall = (o: HTMLElement) => {
    for (let n: HTMLElement = o; n !== document.body && n.parentElement; n = n.parentElement) {
      for (const s of n.parentElement.children) {
        if (s === n || !(s instanceof HTMLElement) || s.inert || /^(SCRIPT|STYLE)$/.test(s.tagName) || s.matches(".toast,[role=status],[aria-live]")) continue;
        s.inert = true; walled.push(s);
      }
    }
  };
  const sync = () => {
    const next = topOf(overlays());
    if (next === top) return;
    const prev = top;
    top = next;
    unwall();
    if (next) {
      if (!back.has(next)) back.set(next, prev && prev.contains(document.activeElement) ? (document.activeElement as HTMLElement) : outside);
      const box = boxOf(next);
      label(box);
      wall(next);
      // Chờ một khung hình: autoFocus của React và hiệu ứng mở chạy xong.
      requestAnimationFrame(() => {
        if (top !== next || next.contains(document.activeElement)) return;
        const field = focusables(box).find((e) => e.matches('input:not([type="checkbox"]):not([type="radio"]):not([readonly]),textarea,select,[autofocus]'));
        if (field) { field.focus({ preventScroll: true }); return; }
        if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
        box.focus({ preventScroll: true });
      });
    }
    // Hộp vừa đóng (không phải vừa bị hộp khác che): trả tiêu điểm về chỗ cũ.
    if (prev && !prev.isConnected || (prev && prev.closest(".closing"))) {
      const to = back.get(prev!);
      if (to?.isConnected) requestAnimationFrame(() => { const a = document.activeElement; if (!to.closest("[inert]") && (!a || a === document.body || !a.isConnected || prev!.contains(a))) to.focus({ preventScroll: true }); });
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !top) return;
    const a = document.activeElement as HTMLElement | null;
    // Tiêu điểm đang ở lớp nổi gắn vào body do chính hộp mở (danh sách chọn): để lớp đó tự lo.
    if (a && a !== document.body && !top.contains(a) && !a.closest("[inert]")) return;
    const box = boxOf(top), list = focusables(box);
    if (!list.length) { e.preventDefault(); box.focus({ preventScroll: true }); return; }
    const i = a ? list.indexOf(a) : -1;
    if (e.shiftKey ? i <= 0 : i < 0 || i === list.length - 1) { e.preventDefault(); list[e.shiftKey ? list.length - 1 : 0].focus({ preventScroll: true }); }
  };
  const onFocus = (e: FocusEvent) => { const t = e.target as HTMLElement; if (t?.closest && !t.closest(".overlay")) outside = t; };
  // Safari không đưa tiêu điểm vào nút khi bấm chuột: nhớ nút vừa bấm.
  const onDown = (e: PointerEvent) => { const t = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("button,a,[tabindex]"); if (t && !t.closest(".overlay")) outside = t; };
  let raf = 0;
  const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("pointerdown", onDown, true);
  sync();
  return () => { mo.disconnect(); cancelAnimationFrame(raf); unwall(); document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocus, true); document.removeEventListener("pointerdown", onDown, true); };
}
