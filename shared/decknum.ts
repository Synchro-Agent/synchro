// Đánh số slide nhất quán (H1 T8): bản sửa mode="patch" thêm / bớt slide mà chỉ đánh số lại một phần (nhãn mục nhảy cóc "02 → 04", số trang
// sai thứ tự, tổng "/ 07" lẫn "/ 06"). Đọc thẳng mã HTML của bộ slide (không cần dựng trang) nên dùng được cả ở check_artifact lẫn hội đồng
// phản biện. Tệp thuần, không phụ thuộc gì: tests/api/deck-quality.test.mjs.
//
// Chỉ báo khi chắc: slide liệt kê nhiều số (mục lục, các bước 01 02 03) thì bỏ qua slide đó; cần ít nhất 3 slide có số mới xét một dãy.
// Không báo các cách trình bày có chủ ý (review W10): bìa không đánh số nên nhãn mục "01 · Vấn đề" nằm ở trang "02 / 06" (chênh cố định),
// một mục trải trên nhiều slide liền nhau (cùng nhãn "02"), slide không có nhãn mục xen giữa.

export type DeckSlide = { index: number; line: number; text: string[] };
// kind: order (số trang sai thứ tự), total (tổng không đồng nhất), count (tổng khác số slide thật), brow (nhãn mục nhảy cóc / đi lùi),
// mixed (nhãn mục vượt lên trước số trang: mục đã sang số sau mà trang chưa đổi tương ứng).
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

/** Số mục và số trang của từng slide (slide có từ 2 số trở lên cùng loại thì bỏ qua: mục lục, các bước; amb đánh dấu slide đó).
 *  Bộ slide đã dùng nhãn kiểu "02 · Tên mục" (từ 2 slide) thì số đứng riêng ("05" của một chỉ số KPI) không tính là nhãn mục. */
export function slideNumbers(slides: DeckSlide[]) {
  const raw = slides.map((s) => s.text.filter((t) => !PAGE.test(t)).map((t) => EYEBROW.exec(t)).filter((m): m is RegExpExecArray => !!m));
  const named = raw.filter((ms) => ms.some((m) => m[1] !== undefined)).length >= 2;
  return slides.map((s, k) => {
    const pages = s.text.map((t) => PAGE.exec(t)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ n: +m[1], of: +m[2] })).filter((p) => p.of >= 2 && p.n >= 0 && p.n <= p.of);
    const brows = raw[k].filter((m) => !named || m[1] !== undefined).map((m) => +(m[1] ?? m[2]));
    return { index: s.index, line: s.line, page: pages.length === 1 ? pages[0] : null, brow: brows.length === 1 ? brows[0] : null, amb: brows.length > 1 };
  });
}

const fmt2 = (n: number) => String(n).padStart(2, "0");
const range = (xs: number[], f: (n: number) => string = String) => (xs.length > 2 && xs.every((x, i) => i === 0 || x === xs[i - 1] + 1) ? `${f(xs[0])}–${f(xs[xs.length - 1])}` : xs.map(f).join(", "));
/** Độ lệch xuất hiện nhiều nhất (số in trên slide trừ vị trí slide). */
const majority = (xs: number[]) => { const c = new Map<number, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0]; };

/** Lỗi đánh số của bộ slide: số trang sai vị trí / sai tổng, nhãn mục nhảy cóc hay đi lùi, nhãn mục vượt lên trước số trang. */
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
  // Nhãn mục: một mục được trải trên nhiều slide liền nhau (cùng nhãn "02 · Thị trường" ở slide 3 và 4) là cách trình bày thường gặp, không phải lỗi.
  // Chỉ báo khi dãy nhãn nhảy cóc (02 rồi 04) hoặc đi lùi (03 rồi 02); số gợi ý là nhãn trước cộng một, không bao giờ dưới 01.
  const browed = nums.filter((x) => x.brow !== null);
  const flagged = new Set<number>();
  if (browed.length >= 3) {
    const bad: { index: number; line: number; got: number; want: number }[] = [];
    // prev: nhãn đúng ra của slide trước (nhãn sai thì tính như đã sửa thành số gợi ý), để bỏ một mục giữa chừng thì báo mọi nhãn phía sau phải lùi một số.
    let prev = browed[0].brow!;
    for (let k = 1; k < browed.length; k++) {
      const cur = browed[k].brow!;
      // Giữa hai nhãn có slide nhiều số (mục lục, các bước): không biết mục nào nằm ở đó, không so.
      if (nums.some((x) => x.amb && x.index > browed[k - 1].index && x.index < browed[k].index)) { prev = cur; continue; }
      if (cur === prev || cur === prev + 1) { prev = cur; continue; }
      const want = Math.max(1, prev + 1);
      bad.push({ index: browed[k].index, line: browed[k].line, got: cur, want });
      prev = want;
    }
    if (bad.length) {
      for (const b of bad) flagged.add(b.index);
      out.push({ kind: "brow", vars: { slides: range(bad.map((x) => x.index)), want: bad.map((x) => fmt2(x.want)).join(", ") }, slides: bad.map((x) => x.index), line: bad[0].line,
        prompt: `nhãn mục nhảy cóc hoặc đi lùi: ${bad.map((x) => `slide ${x.index} ghi “${fmt2(x.got)}”, theo thứ tự phải là “${fmt2(x.want)}”`).join("; ")}` });
    }
  }
  // Nhãn mục và số trang trên cùng slide: chênh nhau một khoảng cố định (bìa không đánh số mục: "01 · Vấn đề" ở trang "02 / 06") là thiết kế
  // có chủ ý, không báo. Mục trải nhiều slide hay slide không nhãn thì khoảng chênh tăng dần, cũng đúng. Chỉ báo khi khoảng chênh GIẢM
  // (nhãn mục đã tăng nhanh hơn số trang, kiểu bản sửa đánh số lại một nửa) hoặc số mục lớn hơn số trang, ở slide chưa bị báo theo kiểu khác.
  const both = nums.filter((x) => x.page && x.brow !== null);
  const off = (x: (typeof both)[number]) => x.page!.n - x.brow!;
  const ahead = both.filter((x, k) => !flagged.has(x.index) && (off(x) < 0 || (k > 0 && off(x) < off(both[k - 1]))));
  if (ahead.length && !out.some((x) => x.kind === "order")) {
    const brows = range(ahead.map((x) => x.brow!), fmt2), pages = `${range(ahead.map((x) => x.page!.n), fmt2)} / ${fmt2(ahead[0].page!.of)}`;
    out.push({ kind: "mixed", vars: { slides: range(ahead.map((x) => x.index)), brows, pages }, slides: ahead.map((x) => x.index), line: ahead[0].line, prompt: `nhãn mục và số trang lệch nhau trên slide ${range(ahead.map((x) => x.index))}: nhãn mục ${brows} nhưng chân trang ${pages} (nhãn mục đã sang số sau mà số trang chưa theo). Đánh số lại cho cùng một dãy` });
  }
  return out;
}
