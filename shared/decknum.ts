// Đánh số slide nhất quán (H1 T8): bản sửa mode="patch" từng đánh số lại chỉ một phần, bộ slide còn nhãn mục "01 · Vấn đề" … "05 · …"
// trong khi chân trang ghi "02 / 06" … "06 / 06". Đọc thẳng mã HTML của bộ slide (không cần dựng trang) nên dùng được cả ở check_artifact
// lẫn hội đồng phản biện. Tệp thuần, không phụ thuộc gì: tests/api/deck-quality.test.mjs.
//
// Chỉ báo khi chắc: slide liệt kê nhiều số (mục lục, các bước 01 02 03) thì bỏ qua slide đó; cần ít nhất 3 slide có số mới xét một dãy.

export type DeckSlide = { index: number; line: number; text: string[] };
// kind: order (số trang sai thứ tự), total (tổng không đồng nhất), count (tổng khác số slide thật), brow (nhãn mục nhảy cóc / trùng), mixed (nhãn mục lệch số trang).
// prompt: câu tiếng Việt đầy đủ cho model (không hiện cho người dùng); vars: giá trị để nơi hiện cho người dùng tự dựng câu theo ngôn ngữ giao diện.
export type NumIssue = { kind: "order" | "total" | "count" | "brow" | "mixed"; slides: number[]; line: number; prompt: string; vars: Record<string, string | number> };

// Lớp "slide" đứng riêng (không tính "slide-title", "slides"), hoặc thuộc tính data-slide.
const SLIDE_OPEN = /<(section|div|article)\b[^>]*?(?:\sclass\s*=\s*["'](?:[^"']*\s)?slide(?:\s[^"']*)?["']|\sdata-slide(?=[\s=>]))[^>]*>/gi;
const SECTION_OPEN = /<section\b[^>]*>/gi;
const lineAt = (s: string, i: number) => { let n = 1; for (let k = s.indexOf("\n"); k >= 0 && k < i; k = s.indexOf("\n", k + 1)) n++; return n; };
const decode = (s: string) => s.replace(/&nbsp;|&#160;/g, " ").replace(/&middot;|&#183;/g, "·").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&amp;/g, "&").replace(/&#x2F;|&#47;/g, "/");

/** Các slide của bộ (như find() của deckRuntime: section.slide / [data-slide], không đủ 2 thì mọi <section>), mỗi slide là các mẩu chữ theo thứ tự. */
export function deckSlides(html: string): DeckSlide[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  let starts = [...body.matchAll(SLIDE_OPEN)].map((m) => m.index ?? 0);
  if (starts.length < 2) starts = [...body.matchAll(SECTION_OPEN)].map((m) => m.index ?? 0);
  if (starts.length < 2) return [];
  return starts.map((at, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : body.length;
    const chunk = body.slice(at, end).replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ");
    const text = [...chunk.matchAll(/>([^<]+)</g)].map((m) => decode(m[1]).replace(/\s+/g, " ").trim()).filter(Boolean);
    return { index: k + 1, line: lineAt(body, at), text };
  });
}

// "02 / 06", "2/6", "Trang 2 / 6", "Slide 2 of 6".
const PAGE = /^(?:(?:slide|trang|page)\s*)?(\d{1,2})\s*(?:\/|of|trên)\s*(\d{1,2})$/i;
// Nhãn mục: "01 · Vấn đề", "03. Thị trường", "12 — Kết luận", hoặc số đứng riêng có số 0 đầu ("01").
const EYEBROW = /^(?:(\d{2})\s*[·•.\-–—|:]\s*\p{L}.*|(0\d))$/u;

/** Số mục và số trang của từng slide (slide có từ 2 số trở lên cùng loại thì bỏ qua: mục lục, các bước). */
export function slideNumbers(slides: DeckSlide[]) {
  return slides.map((s) => {
    const pages = s.text.map((t) => PAGE.exec(t)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ n: +m[1], of: +m[2] })).filter((p) => p.of >= 2 && p.n >= 0 && p.n <= p.of);
    const brows = s.text.filter((t) => !PAGE.test(t)).map((t) => EYEBROW.exec(t)).filter((m): m is RegExpExecArray => !!m).map((m) => +(m[1] ?? m[2]));
    return { index: s.index, line: s.line, page: pages.length === 1 ? pages[0] : null, brow: brows.length === 1 ? brows[0] : null };
  });
}

const fmt2 = (n: number) => String(n).padStart(2, "0");
const range = (xs: number[], f: (n: number) => string = String) => (xs.length > 2 && xs.every((x, i) => i === 0 || x === xs[i - 1] + 1) ? `${f(xs[0])}–${f(xs[xs.length - 1])}` : xs.map(f).join(", "));
/** Độ lệch xuất hiện nhiều nhất (số in trên slide trừ vị trí slide). */
const majority = (xs: number[]) => { const c = new Map<number, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0]; };

/** Lỗi đánh số của bộ slide: số trang sai vị trí / sai tổng, nhãn mục nhảy cóc hay trùng, nhãn mục và số trang trên cùng slide lệch nhau. */
export function numberingIssues(html: string): NumIssue[] {
  const slides = deckSlides(html);
  if (slides.length < 3) return [];
  const nums = slideNumbers(slides), total = slides.length, out: NumIssue[] = [];
  const paged = nums.filter((x) => x.page);
  if (paged.length >= 3) {
    const off = majority(paged.map((x) => x.page!.n - x.index));
    const ofs = majority(paged.map((x) => x.page!.of));
    const wrongPos = paged.filter((x) => x.page!.n - x.index !== off);
    if (wrongPos.length) out.push({ kind: "order", vars: { slides: range(wrongPos.map((x) => x.index)) }, slides: wrongPos.map((x) => x.index), line: wrongPos[0].line, prompt: `số trang không theo thứ tự slide: ${wrongPos.map((x) => `slide ${x.index} ghi “${fmt2(x.page!.n)} / ${fmt2(x.page!.of)}”, đúng ra là “${fmt2(x.index + off)} / ${fmt2(ofs)}”`).join("; ")}` });
    const wrongOf = paged.filter((x) => x.page!.of !== ofs);
    if (wrongOf.length) out.push({ kind: "total", vars: { slides: range(wrongOf.map((x) => x.index)) }, slides: wrongOf.map((x) => x.index), line: wrongOf[0].line, prompt: `tổng số trang không đồng nhất: ${wrongOf.map((x) => `slide ${x.index} ghi “/ ${fmt2(x.page!.of)}”`).join(", ")}, các slide khác ghi “/ ${fmt2(ofs)}”` });
    // Tổng ghi trên slide phải bằng số slide thật (bỏ bìa không đánh số thì ít hơn đúng số slide đứng trước trang 1).
    const expect = total + off;
    if (ofs !== expect && !wrongOf.length) out.push({ kind: "count", vars: { of: ofs, total }, slides: paged.map((x) => x.index), line: paged[0].line, prompt: `chân trang ghi tổng “/ ${fmt2(ofs)}” nhưng bộ slide có ${total} slide (theo cách đánh số này, tổng phải là ${fmt2(expect)})` });
  }
  const browed = nums.filter((x) => x.brow !== null);
  if (browed.length >= 3) {
    const off = majority(browed.map((x) => x.brow! - x.index));
    const bad = browed.filter((x) => x.brow! - x.index !== off);
    if (bad.length) out.push({ kind: "brow", vars: { slides: range(bad.map((x) => x.index)) }, slides: bad.map((x) => x.index), line: bad[0].line, prompt: `nhãn mục nhảy cóc hoặc trùng số: ${bad.map((x) => `slide ${x.index} ghi “${fmt2(x.brow!)}”, theo thứ tự phải là “${fmt2(x.index + off)}”`).join("; ")}` });
  }
  // Cùng một slide mang hai số khác nhau (nhãn mục "01" mà chân trang "02 / 06"): người xem không biết đang ở trang nào.
  const both = nums.filter((x) => x.page && x.brow !== null && x.page.n !== x.brow);
  if (both.length >= 2 || (both.length === 1 && nums.filter((x) => x.page && x.brow !== null).length === 1)) {
    const brows = range(both.map((x) => x.brow!), fmt2), pages = `${range(both.map((x) => x.page!.n), fmt2)} / ${fmt2(both[0].page!.of)}`;
    out.push({ kind: "mixed", vars: { slides: range(both.map((x) => x.index)), brows, pages }, slides: both.map((x) => x.index), line: both[0].line, prompt: `nhãn mục và số trang lệch nhau trên slide ${range(both.map((x) => x.index))}: nhãn mục ${brows} nhưng chân trang ${pages}. Đánh số lại cho khớp (cùng một dãy) hoặc bỏ một trong hai loại số` });
  }
  return out;
}
