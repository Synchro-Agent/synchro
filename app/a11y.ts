// Bàn phím và tiêu điểm dùng chung cho mọi menu và hộp thoại của app (không phải sửa từng nơi, hộp và menu thêm sau tự có):
// - Menu (ui.tsx): Esc đóng menu rồi trả tiêu điểm về nút mở (không đóng luôn hộp thoại bên dưới); mũi tên, Home, End đi giữa các mục; phải / trái vào, ra menu con.
// - Hộp thoại (.overlay): vai trò dialog, tiêu điểm đầu tiên, Tab chỉ đi trong hộp, đóng thì trả tiêu điểm về chỗ cũ.
type Entry = { el: HTMLElement; opener: HTMLElement | null };
const menus: Entry[] = [];
// Người dùng đang thao tác bằng bàn phím hay chuột: menu mở bằng chuột không tự chuyển tiêu điểm vào trong.
let viaKey = false;
const parentItem = new WeakMap<HTMLElement, HTMLElement>();
const active = () => document.activeElement as HTMLElement | null;
const visible = (e: HTMLElement) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
const raf2 = (f: () => void) => requestAnimationFrame(() => requestAnimationFrame(f));

const ITEM = 'button.menu-item,a.menu-item,.cv-mode-item,.cv-opt,.cm-find input,.menu-item>.toggle,.msub-note button,[role^="menuitem"]';
const itemsOf = (m: HTMLElement) => [...m.querySelectorAll<HTMLElement>(ITEM)].filter((x) => x.closest(".menu") === m && !(x as HTMLButtonElement).disabled && visible(x));

// Nút mở của một menu: nút đứng ngay trước menu (cùng cha).
function openerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
    if (p instanceof HTMLButtonElement) return p;
    const b = p.querySelector?.("button");
    if (b && !p.classList.contains("menu")) return b as HTMLElement;
  }
  return null;
}

/** Menu vừa mở: nhớ nút mở, báo trạng thái cho trình đọc màn hình; mở bằng bàn phím thì đưa tiêu điểm vào mục đang chọn hoặc mục đầu. Trả về hàm dọn khi menu đóng. */
export function registerMenu(el: HTMLElement) {
  const nested = !!el.parentElement?.closest(".menu");
  const opener = nested ? null : openerOf(el);
  const entry: Entry = { el, opener };
  menus.push(entry);
  if (opener) { opener.setAttribute("aria-haspopup", el.getAttribute("role") === "menu" ? "menu" : "true"); opener.setAttribute("aria-expanded", "true"); }
  if (nested && !parentItem.has(el)) { const a = active(); if (a?.closest(".menu")) parentItem.set(el, a); }
  if (viaKey) raf2(() => {
    if (!el.isConnected || el.contains(active())) return;
    const l = itemsOf(el);
    (l.find((x) => x.querySelector(":scope > .ck")) ?? l[0])?.focus();
  });
  return () => {
    const i = menus.indexOf(entry);
    if (i >= 0) menus.splice(i, 1);
    if (opener) opener.setAttribute("aria-expanded", "false");
    // Chọn một mục bằng bàn phím: mục đó sắp biến mất, trả tiêu điểm về nút mở để không rơi về đầu trang.
    if (viaKey && !nested && opener?.isConnected) { const a = active(); if (!a || a === document.body || el.contains(a)) opener.focus({ preventScroll: true }); }
  };
}

/** Vai trò của các mục trong menu (mục có dấu tích là đang chọn). Mục đã tự khai báo vai trò thì giữ nguyên. */
export function labelMenu(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>("button.menu-item,a.menu-item,.cv-mode-item").forEach((b) => {
    if (b.hasAttribute("role") && !b.dataset.mr) return;
    b.dataset.mr = "1";
    const ck = !!b.querySelector(":scope > .ck");
    b.setAttribute("role", ck ? "menuitemcheckbox" : "menuitem");
    if (ck) b.setAttribute("aria-checked", "true"); else b.removeAttribute("aria-checked");
  });
}

// Đóng mọi menu đang mở: các menu đều đóng khi bấm ra ngoài nên giả lập một lần bấm ra ngoài (cùng cách page.tsx đóng hộp thoại bằng Esc).
const closeMenus = () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

function moveIn(m: HTMLElement, key: string, a: HTMLElement | null) {
  const l = itemsOf(m);
  if (!l.length) return;
  const i = a ? l.indexOf(a) : -1;
  const n = key === "Home" ? 0 : key === "End" ? l.length - 1 : key === "ArrowDown" ? (i + 1) % l.length : i < 0 ? l.length - 1 : (i - 1 + l.length) % l.length;
  l[n].focus();
}

function menuKey(e: KeyboardEvent) {
  const top = menus[menus.length - 1];
  if (!top) return false;
  const a = active();
  // Menu đang chứa tiêu điểm (có thể là menu con không qua Menu, như .cm-fly); tiêu điểm ở nút mở hay chưa ở đâu thì tính là menu trên cùng.
  const inside = a?.closest<HTMLElement>(".menu") ?? null;
  const known = inside && menus.some((m) => m.el.contains(inside));
  const box = known ? inside : top.el;
  if (e.key === "Escape") {
    e.preventDefault(); e.stopImmediatePropagation();
    const back = box.querySelector<HTMLElement>(":scope > .cm-back");
    if (back) { const up = box.parentElement?.closest<HTMLElement>(".menu"); back.click(); if (up) raf2(() => (itemsOf(up).find((x) => x.classList.contains("on")) ?? itemsOf(up)[0])?.focus()); return true; }
    const root = menus.find((m) => m.el.contains(box)) ?? top, op = menus.find((m) => m.opener)?.opener ?? root.opener;
    closeMenus();
    op?.focus({ preventScroll: true });
    return true;
  }
  const typing = !!a && a.matches("input,textarea,select,[contenteditable=true]");
  // Đang gõ ở ô ngoài menu (ô soạn tin…): mũi tên vẫn là của ô đó.
  if (typing && !known) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || (!typing && (e.key === "Home" || e.key === "End"))) {
    e.preventDefault();
    moveIn(box, e.key, known ? a : null);
    return true;
  }
  if (e.key === "ArrowRight" && known && !typing && a?.getAttribute("aria-haspopup")) {
    e.preventDefault();
    a.click();
    raf2(() => {
      const sub = [...box.querySelectorAll<HTMLElement>(".menu")].filter((x) => x.parentElement?.closest(".menu") === box && visible(x)).pop();
      if (!sub) return;
      parentItem.set(sub, a);
      const inp = sub.querySelector<HTMLInputElement>("input");
      (inp ?? itemsOf(sub)[0])?.focus();
    });
    return true;
  }
  if (e.key === "ArrowLeft" && known && !typing) {
    const up = box.parentElement?.closest<HTMLElement>(".menu");
    if (!up) return false;
    e.preventDefault();
    const it = parentItem.get(box), back = box.querySelector<HTMLElement>(":scope > .cm-back");
    if (back) back.click();
    (it?.isConnected ? it : itemsOf(up)[0])?.focus();
    return true;
  }
  // Tab rời menu chỉ có các mục (không có ô nhập): đóng menu, tiêu điểm đi tiếp như thường.
  if (e.key === "Tab" && known && !top.el.querySelector("input,textarea,select")) { closeMenus(); return false; }
  return false;
}

// ---------------------------------------------------------------- hộp thoại
type Modal = { ov: HTMLElement; back: HTMLElement | null };
const modals: Modal[] = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';
const focusables = (r: HTMLElement) => [...r.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
let uid = 0;

function setup(ov: HTMLElement) {
  const box = ov.querySelector<HTMLElement>(".modal,[role=dialog]") ?? (ov.firstElementChild as HTMLElement | null) ?? ov;
  if (!box.getAttribute("role")) box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
  if (!box.getAttribute("aria-label") && !box.getAttribute("aria-labelledby")) {
    const h = box.querySelector<HTMLElement>("h1,h2,h3");
    if (h) { h.id ||= `dlg-h-${++uid}`; box.setAttribute("aria-labelledby", h.id); }
  }
  raf2(() => {
    if (!ov.isConnected || box.contains(active())) return;
    // Điện thoại: không tự mở bàn phím ảo. Bàn phím: ô nhập đầu tiên, không có thì nút đầu tiên trừ nút đóng (hộp xác nhận: Hủy, không phải Xóa).
    // Mở bằng chuột: không tự nhảy vào ô nào (không hiện viền tiêu điểm); Tab đi tiếp từ đầu hộp.
    const coarse = matchMedia("(pointer: coarse)").matches || !viaKey, all = focusables(box);
    const first = coarse ? null : all.find((x) => x.matches("[autofocus]")) ?? all.find((x) => x.matches("input,textarea,select")) ?? all.find((x) => !x.matches('.close,.sy-x,[aria-label="Đóng"],[aria-label="Close"]'));
    (first ?? box).focus({ preventScroll: true });
  });
}

function syncModals() {
  const live = document.getElementsByClassName("overlay");
  if (live.length === modals.length && modals.every((m) => m.ov.isConnected)) return;
  for (let i = modals.length - 1; i >= 0; i--) if (!modals[i].ov.isConnected) {
    const [m] = modals.splice(i, 1), a = active();
    // Đóng hộp: tiêu điểm về chỗ cũ, trừ khi người dùng hay hộp đã chuyển nó đi nơi khác có chủ đích.
    if (m.back?.isConnected && (!a || a === document.body)) m.back.focus({ preventScroll: true });
  }
  for (const ov of Array.from(live) as HTMLElement[]) if (!modals.some((m) => m.ov === ov)) {
    const a = active();
    // Hộp mở từ một mục menu: mục đó sắp biến mất, nhớ nút mở menu thay cho nó.
    const inMenu = a?.closest<HTMLElement>(".menu");
    const op = inMenu ? menus.find((m) => m.el.contains(inMenu))?.opener : null;
    modals.push({ ov, back: op ?? (a && a !== document.body ? a : null) });
    setup(ov);
  }
}

const topModal = () => {
  const l = modals.filter((m) => !m.ov.closest(".closing"));
  const z = (o: Element) => Number(getComputedStyle(o).zIndex) || 0;
  return l.length ? l.reduce((a, m) => (z(m.ov) >= z(a.ov) ? m : a)) : null;
};

function trapTab(e: KeyboardEvent) {
  const m = topModal();
  if (!m) return;
  const l = focusables(m.ov), a = active();
  if (!l.length) { e.preventDefault(); return; }
  if (!a || !m.ov.contains(a)) { e.preventDefault(); l[0].focus(); return; }
  const i = l.indexOf(a);
  if (e.shiftKey && i <= 0) { e.preventDefault(); l[l.length - 1].focus(); }
  else if (!e.shiftKey && i === l.length - 1) { e.preventDefault(); l[0].focus(); }
}

let installed = false;
/** Gắn một lần cho cả trang (page.tsx). */
export function installA11y() {
  if (installed || typeof document === "undefined") return () => {};
  installed = true;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Shift" && e.key !== "Meta" && e.key !== "Control" && e.key !== "Alt") viaKey = true;
    if (e.isComposing) return;
    // Nút mở menu đang có tiêu điểm: mũi tên xuống cũng mở menu.
    if (e.key === "ArrowDown" && !menus.length) { const a = active(); if (a?.matches('button[aria-haspopup="menu"][aria-expanded="false"]') && !a.closest(".menu")) { e.preventDefault(); a.click(); return; } }
    menuKey(e);
    if (e.key === "Tab" && !e.defaultPrevented) trapTab(e);
  };
  const onPointer = () => { viaKey = false; };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  const mo = new MutationObserver(syncModals);
  mo.observe(document.body, { childList: true, subtree: true });
  syncModals();
  return () => { installed = false; window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onPointer, true); mo.disconnect(); };
}
