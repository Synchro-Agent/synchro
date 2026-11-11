// Đề xuất dự án / sách mỏng: gói @preview/ilm:1.4.0 (MIT-0) đúng phiên bản chủ dự án chọn, Typst 0.15.1.
// Bìa (tiêu đề, tác giả, tóm tắt, ngày), lời nói đầu, mục lục, chương sang trang mới, chân trang có tên chương là của gói.
#import "@preview/ilm:1.4.0": *
#import "../_lib/blocks.typ": *

#set text(lang: data.lang)
// Gói đặt phông mã Iosevka / Fira Mono (không có trong sandbox): dùng JetBrains Mono. Thân bài Libertinus Serif (có sẵn trong Typst) đủ dấu.
#show: font-remap(("iosevka": "JetBrains Mono", "fira mono": "JetBrains Mono"))
#show: synchro-rules
#show: ilm.with(
  title: data.title,
  author: data.author,
  paper-size: "a4",
  date: parse-date(get(data, "date")),
  date-format: data.date_format,
  abstract: if get(data, "abstract") != none { inline(data.abstract) },
  preface: if get(data, "preface") != none {
    heading(level: 1, numbering: none, outlined: false, if vi { "Lời nói đầu" } else { "Preface" })
    for b in data.preface { render-block(b) }
  },
  table-of-contents: if data.toc { outline(title: if vi { "Mục lục" } else { auto }) } else { none },
  chapter-pagebreak: data.chapter_pagebreak,
  external-link-circle: true,
  appendix: (
    enabled: get(data, "appendix") != none,
    title: get(get(data, "appendix", default: (:)), "title", default: ""),
    heading-numbering-format: "A.1.1.",
    body: if get(data, "appendix") != none { render-sections(data.appendix.sections) },
  ),
  figure-index: (enabled: data.figure_index, title: if vi { "Danh mục hình" } else { "Index of Figures" }),
  table-index: (enabled: data.table_index, title: if vi { "Danh mục bảng" } else { "Index of Tables" }),
)
#render-sections(data.sections)
#render-references(get(data, "references"))
