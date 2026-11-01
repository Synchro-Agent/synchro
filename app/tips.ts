"use client";
// Gợi ý khi rê chuột (data-tip). Trước đây vẽ bằng ::after ngay trong phần tử nên bị khung cha cắt (thanh điều hướng cuộn dọc, khung artifact)
// hay bị lớp khác che, và luôn nằm phía trên nên nút sát mép trên (thanh công cụ của khung artifact khi phóng to, thanh trên) chỉ còn một vệt.
// Nay một khung gợi ý duy nhất gắn vào body (position: fixed, trên mọi lớp): đo kích thước thật, ưu tiên phía trên, không đủ chỗ thì lật xuống,
// luôn nằm trọn trong màn hình; mục của thanh điều hướng dọc vẫn hiện bên phải. CSS tắt gợi ý ::after khi <html data-tips="js">.

const DELAY = 400, GAP = 6, EDGE = 8;

// px / py: vị trí con trỏ gần nhất — phần tử có thể bị vẽ lại (thanh công cụ cập nhật) trong lúc chờ: lúc hiện thì tìm lại đúng phần tử dưới con trỏ.
let tip: HTMLDivElement | null = null, cur: Element | null = null, timer = 0, px = -1, py = -1;

function el() {
  if (tip?.isConnected) return tip;
  tip = document.createElement("div");
  tip.className = "tip-float";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  return tip;
}

/** Đặt khung gợi ý cạnh phần tử: trên (mặc định) / dưới / phải (thanh điều hướng), canh giữa rồi kẹp trong màn hình. Trả về vị trí đã chọn. */
export function placeFloat(t: HTMLElement, target: Element): "top" | "bottom" | "right" {
  const r = target.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
  const W = innerWidth, H = innerHeight;
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), W - EDGE - w);
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), H - EDGE - h);
  if (target.closest(".rail") && r.right + 10 + w <= W - EDGE) {
    t.style.left = `${r.right + 10}px`; t.style.top = `${clampY(r.top + r.height / 2 - h / 2)}px`;
    return "right";
  }
  const above = r.top - GAP - h >= EDGE, below = r.bottom + GAP + h <= H - EDGE;
  const side = above || !below ? "top" : "bottom";
  t.style.left = `${clampX(r.left + r.width / 2 - w / 2)}px`;
  t.style.top = `${side === "top" ? Math.max(EDGE, r.top - GAP - h) : r.bottom + GAP}px`;
  return side;
}

function hide() {
  clearTimeout(timer);
  cur = null;
  if (tip) tip.classList.remove("on");
}

function show(target: Element) {
  const text = target.getAttribute("data-tip");
  if (!text || !target.isConnected) return;
  const t = el();
  t.textContent = text;
  // Gợi ý dài xuống dòng (không cắt bằng dấu …); nhiều dòng thì bo góc vừa thay cho viên thuốc.
  t.classList.toggle("multi", false);
  t.classList.toggle("multi", t.offsetHeight > 30);
  t.dataset.side = placeFloat(t, target);
  t.classList.add("on");
}

/** Gắn một lần cho cả trang (page.tsx). */
export function installTips() {
  document.documentElement.dataset.tips = "js";
  const over = (e: Event) => {
    // Chạm trên điện thoại cũng sinh pointerover: không hiện gợi ý (nó sẽ nằm lì sau mỗi lần chạm).
    if ((e as PointerEvent).pointerType === "touch") return;
    // Phần tử thật dưới con trỏ (theo tọa độ), không theo đích của sự kiện: cạnh khung xem artifact (iframe), trình duyệt còn phát thêm
    // pointerover cho iframe dù con trỏ vẫn nằm trên nút, làm gợi ý của nút bị hủy (nút "Chỉ và sửa" không bao giờ hiện gợi ý).
    const pe = e as PointerEvent;
    const at = typeof pe.clientX === "number" ? document.elementFromPoint(pe.clientX, pe.clientY) : null;
    const target = (at ?? (e.target as Element | null))?.closest?.("[data-tip]") ?? null;
    if (target === cur) return;
    hide();
    if (!target || target.closest(".auth-root")) return;
    cur = target;
    if ("clientX" in e) { px = (e as PointerEvent).clientX; py = (e as PointerEvent).clientY; }
    timer = window.setTimeout(() => {
      if (cur !== target) return;
      const now = target.isConnected ? target : document.elementFromPoint(px, py)?.closest("[data-tip]");
      if (now) { cur = now; show(now); }
    }, DELAY);
  };
  // Bàn phím: gợi ý hiện ngay khi tab tới phần tử (như :focus-visible), ẩn khi rời đi.
  const focus = (e: Event) => {
    const target = (e.target as Element | null)?.closest?.("[data-tip]");
    if (!target || !(target as HTMLElement).matches(":focus-visible")) return;
    cur = target; show(target);
  };
  const off = () => hide();
  document.addEventListener("pointerover", over, true);
  document.addEventListener("focusin", focus, true);
  document.addEventListener("focusout", off, true);
  document.addEventListener("pointerdown", off, true);
  document.addEventListener("keydown", off, true);
  addEventListener("scroll", off, true);
  addEventListener("blur", off);
  return () => {
    delete document.documentElement.dataset.tips;
    document.removeEventListener("pointerover", over, true);
    document.removeEventListener("focusin", focus, true);
    document.removeEventListener("focusout", off, true);
    document.removeEventListener("pointerdown", off, true);
    document.removeEventListener("keydown", off, true);
    removeEventListener("scroll", off, true);
    removeEventListener("blur", off);
    hide(); tip?.remove(); tip = null;
  };
}
