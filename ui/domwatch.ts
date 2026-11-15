"use client";
// Một MutationObserver chung cho <body> (blueprint B2 bước 9) thay cho bốn bộ theo dõi riêng: bộ dịch giao diện (i18n.tsx), khung nổi luôn
// nằm trong màn hình (floatfit.ts), hộp thoại / tiêu điểm (a11y.ts) và lớp kính của ô soạn tin (glass.tsx). Mỗi thay đổi của trang trước đây
// được trình duyệt ghi và gửi bốn lần; nay một lần, mỗi nơi nhận đúng loại bản ghi nó cần (childList / characterData / attributes).
// - Chữ của câu trả lời đang chảy (.ai-streaming): bỏ bản ghi đổi chữ và bản ghi chỉ thêm / bớt nút chữ trong đó trước khi gửi đi. Không ai cần:
//   bộ dịch bỏ qua .ai-msg, ba nơi còn lại chỉ xét phần tử. Phần tử mới trong câu trả lời đang viết (thẻ hỏi lại, chip thư viện, menu) vẫn được gửi.
// - Mọi nơi chạy ngay trong lượt gọi lại (trước khi vẽ ra màn hình): bộ dịch và floatfit để không nháy một khung hình chữ chưa dịch / menu tràn
//   mép (điện thoại), a11y để trả tiêu điểm đúng chỗ, lớp kính để ô soạn tin không hiện một khung hình không có kính khi chuyển trang.
// - Bản ghi do chính các nơi nhận ghi ra trong lượt gọi lại (bộ dịch đổi chữ / thuộc tính: chỉ characterData và attributes) được bỏ bằng
//   takeRecords(), thay cho việc bộ dịch tự ngắt rồi gắn lại bộ theo dõi quanh lần ghi của nó; bản ghi childList (lớp kính thêm bộ lọc SVG) thì gửi tiếp.
export type WatchKind = "childList" | "characterData" | "attributes";
type Sub = { fn: (recs: MutationRecord[]) => void; types: ReadonlySet<WatchKind>; attrs?: readonly string[]; order: number };

const subs: Sub[] = [];
let mo: MutationObserver | null = null;

const inStream = (n: Node | null) => !!(n && (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".ai-streaming"));
const textOnly = (l: NodeList) => { for (let i = 0; i < l.length; i++) if (l[i].nodeType !== 3) return false; return true; };
/** Bản ghi chỉ là chữ đang chảy của câu trả lời đang viết. */
const streamText = (r: MutationRecord) => (r.type === "characterData" || (r.type === "childList" && textOnly(r.addedNodes) && textOnly(r.removedNodes))) && inStream(r.target);

function send(recs: MutationRecord[]) {
  const l = recs.filter((r) => !streamText(r));
  if (!l.length) return;
  for (const s of [...subs]) {
    const mine = l.filter((r) => s.types.has(r.type as WatchKind));
    if (mine.length) { try { s.fn(mine); } catch (e) { console.error(e); } }
  }
}

function onRecords(recs: MutationRecord[]) {
  send(recs);
  // Bản ghi phát sinh trong lúc các nơi nhận chạy: đổi chữ / thuộc tính là chính bộ dịch ghi ra (bỏ), thêm / bớt nút thì gửi tiếp (tối đa vài vòng).
  for (let i = 0; i < 3 && mo; i++) {
    const more = mo.takeRecords().filter((r) => r.type === "childList");
    if (!more.length) break;
    send(more);
  }
}

function config(): MutationObserverInit | null {
  if (!subs.length) return null;
  const want = (k: WatchKind) => subs.some((s) => s.types.has(k));
  const attrs = [...new Set(subs.flatMap((s) => (s.types.has("attributes") ? s.attrs ?? [] : [])))];
  return { subtree: true, childList: want("childList"), characterData: want("characterData"), ...(want("attributes") && attrs.length ? { attributes: true, attributeFilter: attrs } : {}) };
}

function reobserve() {
  if (typeof document === "undefined") return;
  // Gửi nốt bản ghi đang chờ trước khi đổi cấu hình (disconnect bỏ chúng đi).
  const pend = mo?.takeRecords() ?? [];
  mo?.disconnect();
  const cfg = config();
  if (cfg) { mo ??= new MutationObserver(onRecords); mo.observe(document.body, cfg); } else mo = null;
  if (pend.length) onRecords(pend);
}

/** Theo dõi thay đổi của <body>. types: loại bản ghi cần; attrs: thuộc tính cần theo dõi (khi có "attributes"). order: nơi số nhỏ nhận trước
 *  (bộ dịch nhận đầu tiên để các nơi đo kích thước thấy chữ đã dịch). Trả về hàm thôi theo dõi; không còn ai thì ngắt bộ theo dõi. */
export function watch(fn: (recs: MutationRecord[]) => void, o: { types: WatchKind[]; attrs?: readonly string[]; order?: number }): () => void {
  const s: Sub = { fn, types: new Set(o.types), attrs: o.attrs, order: o.order ?? 10 };
  subs.push(s);
  subs.sort((a, b) => a.order - b.order);
  reobserve();
  return () => { const i = subs.indexOf(s); if (i < 0) return; subs.splice(i, 1); reobserve(); };
}
