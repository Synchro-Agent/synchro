// Phần dùng chung của 3 mẫu Typst trong Synchro (basic-report 0.1.0, ilm 1.4.0, charged-ieee 0.1.3).
// Đọc nội dung từ payload.json mà synchro-doc đã kiểm và chuẩn hóa (mọi chữ là mảng đoạn {text, bold, italic, code, link}).
// Chữ của payload chỉ được chèn như chữ thường, không bao giờ eval, nên nội dung (#, $, *, <, @…) không làm hỏng biên dịch.
// Phải chạy được trên cả Typst 0.12.0 (basic-report) lẫn 0.15.1: đừng dùng tính năng mới hơn 0.12 ở đây.

#let data = json(sys.inputs.at("payload", default: "payload.json"))
#let vi = data.at("lang", default: "vi") == "vi"
#let get(d, k, default: none) = if type(d) == dictionary and k in d and d.at(k) != none { d.at(k) } else { default }

// "2026-11-11" -> datetime, khác -> none
#let parse-date(s) = {
  if type(s) != str { return none }
  let m = s.match(regex("^(\d{4})-(\d{2})-(\d{2})$"))
  if m == none { return none }
  datetime(year: int(m.captures.at(0)), month: int(m.captures.at(1)), day: int(m.captures.at(2)))
}

// Thay phông mà gói ghi cứng (không có dấu tiếng Việt hoặc không cài) bằng phông có đủ dấu. map: tên thường -> phông thay.
#let font-remap(map) = body => {
  show text: it => context {
    let f = text.font
    let fams = if type(f) == array { f } else { (f,) }
    let names = fams.map(x => lower(if type(x) == dictionary { x.name } else { x }))
    let hit = names.find(n => n in map)
    if hit == none { it } else { set text(font: map.at(hit)); it }
  }
  body
}

// Chữ: một dòng xuống hàng ("\n") trong đoạn thành ngắt dòng.
#let plain-text(t) = {
  let parts = t.split("\n")
  for (i, p) in parts.enumerate() {
    if i > 0 { linebreak() }
    p
  }
}

#let inline(rs) = {
  if rs == none { return [] }
  if type(rs) == str { return plain-text(rs) }
  for r in rs {
    let t = get(r, "text", default: "")
    let c = if get(r, "code", default: false) { raw(t) } else { plain-text(t) }
    if get(r, "bold", default: false) { c = strong(c) }
    if get(r, "italic", default: false) { c = emph(c) }
    let l = get(r, "link")
    if type(l) == str { c = link(l, c) }
    c
  }
}

#let asset(p) = "/" + p.trim("/", at: start)

// Bảng kiểu làm nghề: chỉ kẻ ngang mảnh, số căn phải, tiêu đề cột lặp lại mỗi trang, dòng tổng đậm có kẻ trên, không cắt đôi một dòng.
#let render-table(b) = {
  let n = b.columns.len()
  let al = b.align.map(a => if a == "right" { right } else if a == "center" { center } else { left })
  let ws = get(b, "widths")
  let cols = if ws != none { ws.map(w => w * 1fr) } else if n == 1 { (1fr,) } else { (1fr,) + (auto,) * (n - 1) }
  let rows = b.rows
  let total = get(b, "total", default: false) and rows.len() > 1
  let main = if total { rows.slice(0, rows.len() - 1) } else { rows }
  let rule = 0.5pt + luma(60)
  let cells = main.map(r => r.map(inline)).flatten()
  let tail = if total { (table.hline(stroke: rule),) + rows.last().map(c => strong(inline(c))) } else { () }
  figure(
    kind: table,
    caption: if get(b, "caption") != none { inline(b.caption) },
    table(
      columns: cols,
      align: (x, y) => al.at(x) + horizon,
      stroke: (x, y) => if y > 0 { (bottom: 0.3pt + luma(205)) },
      inset: (x: 6pt, y: 5pt),
      table.hline(stroke: 0.8pt + luma(40)),
      table.header(..b.columns.map(c => strong(inline(c)))),
      table.hline(stroke: rule),
      ..cells,
      ..tail,
      table.hline(stroke: 0.8pt + luma(40)),
    ),
  )
}

#let render-block(b) = {
  let kind = get(b, "type", default: "paragraph")
  if kind == "paragraph" { par(inline(get(b, "text"))) }
  else if kind == "heading" { heading(level: calc.clamp(get(b, "level", default: 2), 1, 3), inline(get(b, "text"))) }
  else if kind == "bullets" { list(..get(b, "items", default: ()).map(inline)) }
  else if kind == "numbered" { enum(..get(b, "items", default: ()).map(inline)) }
  else if kind == "quote" { quote(block: true, attribution: get(b, "by"), inline(get(b, "text"))) }
  else if kind == "callout" {
    block(width: 100%, inset: (x: 10pt, y: 8pt), radius: 3pt, fill: luma(244), stroke: (left: 2.5pt + luma(140)), breakable: false, {
      if get(b, "title") != none { strong(plain-text(b.title)); linebreak() }
      inline(get(b, "text"))
    })
  }
  else if kind == "code" { raw(get(b, "text", default: ""), block: true, lang: get(b, "lang")) }
  else if kind == "table" { render-table(b) }
  else if kind == "image" {
    figure(
      image(asset(b.path), width: calc.clamp(get(b, "width", default: 100), 10, 100) * 1%),
      caption: if get(b, "caption") != none { inline(b.caption) },
    )
  }
  else if kind == "pagebreak" { pagebreak(weak: true) }
}

#let render-sections(secs) = {
  for s in secs {
    if get(s, "heading") != none { heading(level: calc.clamp(get(s, "level", default: 1), 1, 3), inline(s.heading)) }
    for b in get(s, "blocks", default: ()) { render-block(b) }
  }
}

#let references-title = if vi { "Tài liệu tham khảo" } else { "References" }
#let render-references(refs, size: 1em) = {
  if refs == none or refs.len() == 0 { return }
  heading(level: 1, numbering: none, references-title)
  set text(size: size)
  enum(numbering: "[1]", ..refs.map(inline))
}

// Luật chung cho mọi mẫu: tiêu đề bảng đặt trên bảng, bảng dài được ngắt trang (tiêu đề cột lặp lại), hình và chú thích không tách nhau.
#let synchro-rules(body) = {
  show figure.where(kind: table): set figure.caption(position: top)
  show figure.where(kind: table): set block(breakable: true)
  show raw: set text(font: "JetBrains Mono")
  // Số trong bảng: chữ số cao đều, rộng đều để cột số thẳng hàng (Vollkorn, Libertinus mặc định dùng số kiểu cổ).
  show table: set text(number-type: "lining", number-width: "tabular")
  // Không cắt đôi một dòng bảng sang hai trang.
  set table.cell(breakable: false)
  body
}
