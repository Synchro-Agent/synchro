// Bài nghiên cứu / báo cáo kỹ thuật 2 cột kiểu IEEE: gói @preview/charged-ieee:0.1.3 (MIT-0) đúng phiên bản chủ dự án chọn, Typst 0.15.1.
// Phông TeX Gyre Termes / Cursor của gói lấy từ gói Debian fonts-texgyre (đủ dấu tiếng Việt, kể cả ₫).
#import "@preview/charged-ieee:0.1.3": ieee
#import "../_lib/blocks.typ": *

#set text(lang: data.lang)
// Nhãn tiếng Anh ghi cứng trong gói, chỉ dịch khi lang là vi.
#show "Abstract": it => if vi { "Tóm tắt" } else { it }
#show "Index Terms": it => if vi { "Từ khóa" } else { it }
#show "TABLE": it => if vi { "BẢNG" } else { it }
#show "Fig.": it => if vi { "Hình" } else { it }
#show: synchro-rules
#show raw: set text(font: "TeX Gyre Cursor")
#show: ieee.with(
  title: data.title,
  authors: data.authors,
  abstract: if get(data, "abstract") != none { inline(data.abstract) },
  index-terms: data.keywords,
  paper-size: data.paper,
  figure-supplement: if vi [Hình] else [Fig.],
)
#render-sections(data.sections)
#render-references(get(data, "references"), size: 8pt)
