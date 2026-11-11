// Báo cáo doanh nghiệp: gói @preview/basic-report:0.1.0 (MIT) đúng phiên bản chủ dự án chọn, biên dịch bằng Typst 0.12.0
// (bản này lỗi từ Typst 0.13). Bìa, mục lục số trang La Mã, đầu trang có tên chương và số trang là của gói; nội dung lấy từ payload.json.
#import "@preview/basic-report:0.1.0": *
#import "../_lib/blocks.typ": *

// Gói ghi cứng phông tiêu đề Ubuntu (thiếu 44 chữ có dấu tiếng Việt): thay bằng Be Vietnam Pro. Thân bài Vollkorn (bản tĩnh) đủ dấu.
#show: font-remap(("ubuntu": "Be Vietnam Pro"))
#show: synchro-rules
// Nhãn tiếng Đức ghi cứng trong gói: tên mục lục và ngày dd.mm.yyyy trên bìa.
#show "Inhalt": data.toc_title
#show regex("^\d{2}\.\d{2}\.\d{4}"): it => if vi { it.text.replace(".", "/") } else { it }
#show: basic-report.with(
  doc-category: data.category,
  doc-title: data.title,
  author: data.author,
  affiliation: data.affiliation,
  logo: if get(data, "logo") != none { image(asset(data.logo.path), width: 2.5cm) },
  language: data.lang,
)
#render-sections(data.sections)
#render-references(get(data, "references"))
