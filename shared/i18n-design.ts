// Bản dịch cho "Làm theo kiểu này" và "Phong cách của tôi" (ui/designstyleui.tsx, menu + ở ô soạn tin, menu
// Phong cách của artifact) và cho lỗi của /api/design-styles. Lý do không đọc được phong cách là câu mẫu có chỗ trống
// ({host}, {n}): giao diện dịch câu mẫu rồi mới điền giá trị.
export const DESIGN_VI2EN: Record<string, string> = {
  "Làm theo kiểu này…": "Follow this style…",
  "Làm theo kiểu này": "Follow this style",
  "Kiểu: ‹chip phong cách›": "Style:",
  "Bỏ kiểu {name}": "Remove style {name}",
  "Synchro chỉ học màu, chữ và nhịp bố cục của mẫu, không chép logo, chữ hay ảnh của trang đó.":
    "Synchro only learns the colours, type and layout rhythm of the sample. "
    + "It never copies that page's logo, text or images.",
  "Liên kết trang bạn thích": "Link to a page you like",
  "Đọc ‹liên kết phong cách›": "Read",
  "Dùng ảnh đính kèm": "Use the attached image",
  "Đính kèm trước ảnh chụp trang bạn thích": "Attach a screenshot of a page you like first",
  "Phong cách của tôi": "My styles",
  "Chưa có phong cách nào. Lưu từ menu Phong cách của một artifact, hoặc dán liên kết ở trên.":
    "No styles yet. Save one from an artifact's Style menu, or paste a link above.",
  "Tên phong cách": "Style name",
  "còn {n} ngày": "{n} day left|{n} days left",
  "Đổi tên {name}": "Rename {name}",
  "Xóa {name}": "Delete {name}",
  "Xóa phong cách này?": "Delete this style?",
  "{name} sẽ bị xóa cùng ảnh mẫu của nó.": "{name} will be deleted together with its sample image.",
  "Sản phẩm thiết kế tiếp theo sẽ theo kiểu {name}": "Your next design will follow the {name} style",
  "Đang đọc phong cách từ trang {host}…": "Reading the style of {host}…",
  "Đang đọc màu từ ảnh…": "Reading colours from the image…",
  "Hãy dán một liên kết bắt đầu bằng http:// hoặc https://": "Paste a link that starts with http:// or https://",
  "Đã lưu {name} vào Phong cách của tôi": "Saved {name} to My styles",
  "Lưu làm phong cách của tôi": "Save as my style",
  // Tên mặc định của phong cách người dùng không đặt tên: dựng ở giao diện theo ngôn ngữ người xem.
  "Ảnh gửi ngày {d}": "Image sent on {d}",
  "Phong cách mới": "New style",
  // Lỗi của /api/design-styles và lý do không đọc được phong cách (server/designfollow.ts).
  "Không đọc được phong cách": "Couldn't read the style",
  "Không tìm thấy artifact này.": "Couldn't find this artifact.",
  "Không có phong cách này.": "This style doesn't exist.",
  "Không có ảnh này.": "This image doesn't exist.",
  "Bạn đã lưu đủ 20 phong cách. Hãy xóa bớt một phong cách rồi lưu lại.":
    "You've saved the maximum of 20 styles. Delete one, then save again.",
  "Artifact này không dùng bộ phong cách của Synchro: cần ảnh của artifact để đọc màu.":
    "This artifact doesn't use Synchro's style kit, so an image of it is needed to read its colours.",
  "đã đọc phong cách {n} lần trong một giờ, hãy thử lại sau":
    "styles were read {n} times in the last hour, try again later",
  "không có liên kết hay ảnh để đọc phong cách": "there is no link or image to read a style from",
  "ảnh phải là PNG, JPEG, WebP hoặc GIF": "the image must be PNG, JPEG, WebP or GIF",
  "ảnh trống hoặc lớn hơn 12 MB": "the image is empty or larger than 12 MB",
  "không mở được ảnh này": "this image couldn't be opened",
  "không đọc được màu từ ảnh này": "no colours could be read from this image",
  "liên kết không hợp lệ": "the link isn't valid",
  "chỉ đọc được liên kết http hoặc https": "only http or https links can be read",
  "chỉ đọc được trang công khai": "only public pages can be read",
  "máy chủ này chưa mở được trang web để đọc phong cách; hãy gửi ảnh chụp màn hình trang đó":
    "this server can't open web pages to read a style yet; send a screenshot of the page instead",
  "chưa mở được trang {host}": "{host} couldn't be opened",
  "trang {host} trả mã lỗi {code}": "{host} answered with error {code}",
  "trang {host} tải quá lâu": "{host} took too long to load",
  "không đọc được màu của trang {host}; hãy gửi ảnh chụp màn hình thay thế":
    "no colours could be read from {host}; send a screenshot instead",
};
