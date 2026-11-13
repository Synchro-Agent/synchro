// Khối hướng dẫn làm tài liệu PDF / Word bằng 8 mẫu dựng sẵn (4 PDF Typst / WeasyPrint, 4 Word) trong sandbox (lệnh synchro-doc, workspace/doc), cho từng lượt.
// Như videokit.ts: chỉ nạp khi lượt này nhờ làm tệp tài liệu (báo cáo, đề xuất, bài nghiên cứu, hóa đơn / báo giá, hợp đồng, biên bản họp, CV), đi cạnh tin nhắn mới nhất,
// không vào lời nhắc hệ thống, để lượt khác không tốn chữ (mục C5: chỉ nạp schema của đúng loại đang làm). Tệp thuần: tests/api/doc-tools.test.mjs.
// Hợp đồng JSON đầy đủ ở workspace/doc/schemas/*.json (synchro-doc schema <mẫu>); phần tóm tắt dưới đây phải khớp các tệp đó.

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

const MAKE = "lam|tao|viet|soan|lap|xuat|dung|thiet ke|chuan bi|trinh bay|make|create|build|write|draft|generate|prepare|produce|export|issue";
const INVOICE = "hoa don|bao gia|phieu bao gia|invoice|quotation|price quote";
// Mẫu Word (H4): hợp đồng, biên bản họp; CV là tệp để gửi đi nên không cần nói rõ "Word".
const WORD_DOC = "hop dong|bien ban(?: hop| cuoc hop)?|contract|meeting minutes|minutes";
const CV = "cv|so yeu ly lich|ly lich|resume|curriculum vitae";
const DOC = "bao cao|de xuat|de an|ke hoach|tai lieu|proposal|reports?|white ?paper|sach mong|sach|ebook|e-book|bai bao|bai nghien cuu|nghien cuu|research paper|paper|tieu luan|luan van|ho so nang luc|cam nang|handbook|so tay";
// Tệp để in / gửi (không phải artifact Markdown trong chat): nói rõ PDF, Word, khổ in, bố cục của mẫu.
const FILEISH = /\b(?:pdf|word|docx|ban in|in ra|a4|ieee|2 cot|hai cot|two.column|muc luc|trang bia|tai ve|download)\b/;
const MAKE_INVOICE = new RegExp(`\\b(?:${MAKE})\\b[^.?!\\n]{0,60}?\\b(?:${INVOICE})\\b|^(?:${INVOICE})\\b`);
const MAKE_DOC = new RegExp(`\\b(?:${MAKE})\\b[^.?!\\n]{0,60}?\\b(?:${DOC}|${WORD_DOC})\\b`);
const MAKE_CV = new RegExp(`\\b(?:${MAKE})\\b[^.?!\\n]{0,40}?\\b(?:${CV})\\b`);
// "CV" cũng là computer vision, "resume" cũng là động từ (resume training / download): chỉ nhận khi chắc là hồ sơ xin việc.
// Tên đầy đủ thì chắc; động từ tiếng Việt + CV / lý lịch là hồ sơ; còn lại cần ngữ cảnh xin việc, tệp, hay "my / a … resume".
const CV_SURE = /\b(?:so yeu ly lich|curriculum vitae)\b/;
const CV_VI = /\b(?:lam|tao|viet|soan|lap|thiet ke|chuan bi|sua)\b[^.?!\n]{0,20}?\b(?:cv|ly lich)\b/;
const CV_JOB = /\b(?:xin viec|ung tuyen|tuyen dung|vi tri|nha tuyen dung|job|jobs|role|position|apply|applying|application|hiring|recruiters?|internship|thuc tap)\b/;
const CV_MINE = /\b(?:my|a|an|new)\s+(?:\w+\s+){0,2}?(?:cv|resume)\b|\b(?:cv|resume|ly lich)\s+(?:cua|cho)\s+(?:toi|minh|em|anh|chi|ban)\b/;
// Chắc là thị giác máy / tải tiếp / huấn luyện tiếp: không bao giờ là hồ sơ.
const CV_TECH = /\b(?:computer vision|opencv|cv2|models?|training|train|checkpoints?|dataset|detect\w*|yolo|classif\w*|segment\w*|neural|pipeline|downloads?|uploads?|playback|reconnect\w*|stream\w*)\b/;
const RESUME_VERB = /\bresume\s+(?:the|it|this|that|from|where|after|when|on|at|its|playback|training|download\w*|upload\w*)\b/;
// Ngữ cảnh lập trình: chỉ loại khi không có dấu hiệu xin việc ("làm CV xin việc lập trình viên biết code" vẫn là hồ sơ).
const CV_CODE = /\b(?:code|script|function|method|api|endpoint|handler|button|feature|logic|bug|session|process|thread|queue|after)\b/;
function wantsCv(t: string) {
  if (!MAKE_CV.test(t)) return false;
  if (CV_SURE.test(t)) return true;
  if (CV_TECH.test(t) || RESUME_VERB.test(t)) return false;
  if (CV_VI.test(t) || CV_JOB.test(t)) return true;
  return !CV_CODE.test(t) && (CV_MINE.test(t) || FILEISH.test(t));
}
// Hỏi cách làm / hỏi kiến thức, đọc / tóm tắt / dịch tệp có sẵn, đổi định dạng: không phải nhờ làm tài liệu theo mẫu.
const NOT = /\b(?:la gi|tai sao|vi sao|cach (?:lam|tao|viet|lap|xuat)|how (?:do|to|can)|what is|tom tat|summari[sz]e|dich(?! vu)|translate|doc (?:file|tep|giup)|chuyen (?:file|tep)? ?(?:pdf|word)|convert|kiem tra)\b/;

export type DocKind = "invoice" | "doc";
/** Lượt này có phải nhờ làm tệp tài liệu theo mẫu không (chỉ đọc 300 ký tự đầu: phần sau có thể là văn bản dán vào). format: định dạng designkit đã nhận ra. */
export function wantsDoc(typed: string, format?: string | null): DocKind | null {
  const t = fold(typed.trim().slice(0, 300));
  if (!t || NOT.test(t)) return null;
  if (MAKE_INVOICE.test(t)) return "invoice";
  if ((MAKE_DOC.test(t) || format === "doc") && FILEISH.test(t)) return "doc";
  if (wantsCv(t)) return "doc";
  return null;
}

export const DOC_KIT = `<doc_kit>
Tài liệu PDF / Word theo mẫu: trong sandbox có lệnh synchro-doc với 8 mẫu dựng sẵn, không cần mạng. Bạn chỉ viết payload JSON; bố cục, phông có dấu tiếng Việt, bìa, mục lục, số trang là của mẫu. Không tự viết Typst hay HTML cho các loại tài liệu này.
Chọn mẫu: basic-report (báo cáo doanh nghiệp / nội bộ: bìa, mục lục, đầu trang có tên chương và số trang), ilm (đề xuất dự án, kế hoạch, sách mỏng, cẩm nang: bìa có tóm tắt, lời nói đầu, mục lục, chương sang trang mới), charged-ieee (bài nghiên cứu, báo cáo kỹ thuật 2 cột kiểu IEEE), invoice (hóa đơn, báo giá A4). Mẫu Word (chỉ .docx): contract (hợp đồng), minutes (biên bản họp), official-report (báo cáo có mục lục theo thể thức Nghị định 30), cv (sơ yếu lý lịch). Công văn, quyết định, tờ trình, poster, trang A4 thiết kế tự do thì không dùng các mẫu này.
Các bước, mỗi bước một lần run_code (bash):
1) synchro-doc example <mẫu> xem payload mẫu; cần chi tiết thì synchro-doc schema <mẫu>.
2) Viết payload.json (python json.dump, hoặc cat > payload.json <<'EOF' … EOF); ảnh là đường dẫn tương đối (inputs/…, hoặc biểu đồ bạn vẽ bằng matplotlib vào thư mục làm việc).
3) synchro-doc typst <basic-report|ilm|charged-ieee> payload.json outputs/<tên>.pdf --png outputs/_preview — hóa đơn: synchro-doc invoice payload.json outputs/<tên>.pdf --png outputs/_preview. Mã thoát 2 = payload sai: dòng lỗi chỉ đúng trường (payload.sections[1].blocks[0]…), sửa JSON rồi chạy lại; mã 1 = lỗi bộ dựng: báo lại, đừng tự viết Typst thay.
4) Xem ảnh outputs/_preview/<tên>-1.png…: dấu tiếng Việt, bảng, bìa; sửa nội dung rồi dựng lại khi cần.
5) Người dùng muốn Word (.docx): synchro-doc docx <cùng mẫu> payload.json outputs/<tên>.docx — cùng nội dung và đánh số với bản PDF, phông Word sẵn có, mục lục điền sẵn số trang.
Mẫu Word: synchro-doc docx <contract|minutes|official-report|cv> payload.json outputs/<tên>.docx --png outputs/_preview (ảnh và bản PDF tự kiểm "check_pdf" dựng từ chính tệp Word bằng LibreOffice, nằm trong _preview nên không giao cho người dùng). Người dùng muốn cả bản PDF thì thêm --pdf: outputs/<tên>.pdf cạnh tệp Word.
Chung cho 3 mẫu Typst: {title, date?: "YYYY-MM-DD", lang?: "vi"|"en", sections: [{heading, level?: 1–3, text?: "các đoạn cách nhau bằng một dòng trống; dòng '- ' thành gạch đầu dòng, '1. ' thành danh sách số", blocks?: [khối]}], references?: [chuỗi]}. Khối: {type:"paragraph", text} | {type:"heading", level, text} | {type:"bullets"|"numbered", items} | {type:"table", columns, rows, caption?, total?: true (dòng cuối là dòng tổng), align?, widths?} | {type:"image", path, width?: 10–100 (%), caption?} | {type:"quote", text, by?} | {type:"callout", title?, text} | {type:"code", text, lang?} | {type:"pagebreak"}. Trong chữ dùng được **đậm**, *nghiêng*, \`mã\`, [chữ](https://…).
Riêng: basic-report {category (dòng nhỏ trên tiêu đề bìa), author, affiliation, logo?, toc_title?}; ilm {author, abstract (in trên bìa), preface?, toc?, chapter_pagebreak? (mặc định true; tài liệu ngắn dưới 6 trang đặt false), figure_index?, table_index?, appendix?: {title?, sections}}; charged-ieee {authors: [{name, department?, organization?, location?, email?}], abstract, keywords, paper?: "a4"|"us-letter"}.
contract {title, number?, date?, place?, legal_bases?: [dòng "Căn cứ …;"], parties: [{label: "BÊN A (Bên thuê dịch vụ)", name, address?, tax_id?, id_number?, representative?, position?, phone?, email?, bank_account?}] (2–4 bên), articles: [{heading, text?, blocks?}] (tự đánh "Điều 1."), closing?}. minutes {organization?, number?, place?, subject, date, start_time?, end_time? ("HH:MM"), location?, chair?, secretary?, attendees: ["Họ tên" | {name, position}], absent?, agenda?, sections?, decisions?, actions?: [{task, owner, due?}]}. official-report {parent_org?, organization, number? ("15/BC-…"), place?, date?, title (trích yếu), intro?, sections (level 1–3 thành I. / 1. / a)), recipients?, signer: {authority?, title, name}, toc?}. cv {name, headline?, photo?, contact?: {email, phone, location, website, linkedin, github}, summary?, experience?: [{role, org, location?, start?, end?, bullets?}], education?: [{degree, school, start?, end?, detail?}], skills?: [chuỗi | {group, items}], languages?: [{name, level?}], certifications?, projects?}.
Hóa đơn: {number, date, due_date?, currency?: "VND"|"USD"|"EUR", title?: "Hóa đơn"|"Báo giá", from: {name, address: [dòng], tax_id?, email?, phone?}, to: {…}, items: [{description, quantity, unit?, unit_price}], discount? (số tiền), tax_rate? (0.08 là 8%), notes?, payment?: {bank, account, holder}, thanks?, footer?}. Thành tiền, cộng, thuế, tổng do synchro-doc tính: không tự tính, không ghi số tổng vào JSON; JSON kết quả của lệnh có "total" để bạn báo lại.
Quy tắc: số trong bảng viết sẵn kiểu Việt (1.234,5; 12%), cột số tự căn phải; bảng dài tự ngắt trang và lặp tiêu đề cột; mở đầu bằng mục tóm tắt kết luận 2–3 câu, tiêu đề mục nêu điều rút ra. Kiểm thêm bằng pdftotext outputs/<tên>.pdf - | head trước khi báo xong.
</doc_kit>`;

/** Khối cho lượt này: chỉ khi có run_code chạy trên image workspace (nơi có synchro-doc) và người dùng nhờ làm tệp tài liệu. */
export function docTurn(i: { typed: string; code: boolean; workspace: boolean; format?: string | null }): string {
  if (!i.code || !i.workspace || process.env.SYNCHRO_DOCKIT === "0" || /(?:^|\s)#nodockit\b/.test(i.typed)) return "";
  return wantsDoc(i.typed, i.format) ? DOC_KIT : "";
}
