// Khối hướng dẫn dựng video bằng 4 mẫu Remotion có sẵn trong sandbox (lệnh synchro-video, workspace/remotion), cho từng lượt.
// Như designkit.ts: chỉ nạp khi lượt này là việc làm video (định tuyến 2 pha, mục C5), đi cạnh tin nhắn mới nhất, không vào lời nhắc hệ thống,
// để lượt trò chuyện khác không tốn chữ và phần đầu prompt giữ nguyên cho bộ đệm. Tệp thuần (không DB, không mạng): tests/api/videokit.test.mjs.

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

// Danh từ video và cụm động từ làm ra (đã bỏ dấu). "video" đứng sau động từ làm ra trong cùng vế, hoặc danh từ chỉ loại video rõ nghĩa.
const NOUN = "video|clip|reels?|tiktok|shorts|audiogram|motion graphics?|do hoa chuyen dong|logo animation|animation logo|phim ngan|phim gioi thieu|intro video|video intro|outro";
const MAKE = new RegExp(`\\b(?:lam|tao|dung|xuat|render|quay|san xuat|thiet ke|ghep|bien|chuyen|make|create|build|produce|generate|render|edit|turn|animate)\\b[^.?!\\n]{0,60}?\\b(?:${NOUN})\\b`);
const KIND = /\b(?:video (?:tiktok|reels?|shorts|quang cao|gioi thieu|tong ket|ra mat|san pham|podcast|phu de|dong|ngan)|audiogram|motion graphics?|do hoa chuyen dong|logo animation|animation logo|(?:tiktok|reels?|youtube shorts) video|promo video|explainer video|year in review|unwrapped)\b/;
// Hỏi cách làm / hỏi kiến thức, tóm tắt, tải video về: không phải nhờ dựng.
const NOT = /\b(?:la gi|tai sao|vi sao|cach (?:lam|tao|dung)|how (?:do|to|can)|what is|tom tat|summari[sz]e|tai (?:ve|xuong)|download|xem video|phan tich video)\b/;

/** Lượt này có phải nhờ dựng một video không (chỉ đọc 300 ký tự đầu: phần sau có thể là văn bản dán vào). */
export function wantsVideo(typed: string): boolean {
  const t = fold(typed.trim().slice(0, 300));
  if (!t || NOT.test(t)) return false;
  return MAKE.test(t) || KIND.test(t);
}

export const VIDEO_KIT = `<video_kit>
Video đồ họa chuyển động: trong sandbox có lệnh synchro-video với 4 mẫu Remotion 4.0.539 dựng sẵn (60 khung/giây, không cần mạng). Bạn chỉ viết props.json theo schema; mã bố cục của mẫu là cố định.
Video, đồ họa chuyển động, animation logo, phim / intro giới thiệu: dựng bằng Remotion (synchro-video), không dùng Pillow+ffmpeg. Chỉ lùi về Pillow+ffmpeg khi hàng dựng video của máy chủ đang đầy (run_code trả lỗi 503 "đang dựng một video khác"): khi đó báo người dùng đợi, hoặc dựng tạm bằng ffmpeg nếu cần gấp.
Chọn mẫu: tiktok (video dọc ngắn TikTok / Reels / Shorts, phụ đề nhảy từng chữ theo giọng, nền video / ảnh Ken Burns / màu), next-tailwind (giới thiệu, quảng cáo sản phẩm SaaS / công nghệ, animation logo: logo, tiêu đề, lưới tính năng, ảnh chụp màn hình, số liệu, trích dẫn, kêu gọi hành động), audiogram (podcast / âm thanh: sóng âm, bìa, phụ đề chạy theo lời), github-unwrapped (tổng kết số liệu năm: top 3, bộ đếm, lưới theo ngày, theo giờ, theo thứ, so sánh). Slideshow ảnh đơn giản, cắt ghép clip của người dùng thì vẫn dựng bằng ffmpeg như hướng dẫn chung.
Các bước, mỗi bước một lần run_code (bash):
1) synchro-video schema <mẫu> và synchro-video example <mẫu> > props.json: xem trường, giá trị mặc định, ví dụ.
2) Giọng đọc: edge-tts --proxy "$HTTPS_PROXY" --voice vi-VN-HoaiMyNeural -f loi.txt --write-media inputs/giong.mp3 --write-subtitles giong.srt rồi synchro-video words giong.srt phu-de.json (phụ đề từng chữ), ghi "captions": "phu-de.json" và "audio" / "voiceover": "inputs/giong.mp3". Âm thanh / video người dùng gửi, hoặc không có mạng: "captions": "auto" (whisper.cpp nhận dạng tiếng Việt ngay trong sandbox) hoặc synchro-video captions inputs/tep.mp3 phu-de.json --lang vi.
3) synchro-video check <mẫu> props.json: sửa đến khi ok (lỗi ghi rõ trường nào sai); đọc durationSec, estimateSec, runs.
4) synchro-video still <mẫu> props.json [--at 1,4,9]: ảnh vào outputs/_preview/, xem rồi sửa chữ tràn, sai dấu, bố cục trống trước khi dựng.
5) synchro-video render <mẫu> props.json outputs/ten.mp4 (tệp ra phải nằm trong outputs/) với timeout của run_code là 600. Mã thoát 75 = hết ngân sách thời gian của lần chạy (--budget, mặc định 170 giây cho vừa thời gian chờ công cụ, tự ngắn lại khi timeout của run_code ngắn hơn): gọi lại đúng lệnh đó ở lần run_code sau, các đoạn đã dựng được giữ. Mã thoát 137 = hết 2 GB bộ nhớ: giảm --size hoặc dùng --fps 30, đừng chạy lại y nguyên. Máy chủ chỉ dựng một video mỗi lúc: không chạy hai lệnh dựng song song.
6) Kết quả JSON phải có "ok": true, "fps": "60/1", "audioHz": "48000"; mở các ảnh trong "previews" (outputs/_preview/) để tự xem trước khi báo xong, "problems" khác rỗng thì sửa rồi dựng lại.
Quy tắc: đường dẫn tệp trong props là đường dẫn tương đối trong thư mục làm việc (inputs/…); ảnh, nhạc trên mạng thì tải về trước. Mặc định 60 fps, kích thước theo mẫu (tiktok 1080x1920, next-tailwind 1920x1080, audiogram và github-unwrapped 1080x1080); đổi bằng --size vertical|square|landscape, --fps 30 chỉ khi cần dựng nhanh gấp đôi. Chữ nằm trong vùng an toàn 5%, câu ngắn; chỉ dùng phông có dấu tiếng Việt của schema (Be Vietnam Pro mặc định) và một trong 8 style. Tốc độ đo trên máy chủ 2 vCPU ở 60 fps: đồ họa (next-tailwind, github-unwrapped, audiogram) 18–24 khung/giây, tức 30 giây video mất ~1,5–2 phút; có video nền (tiktok) ~8,5 khung/giây, 30 giây mất ~3,5 phút qua vài lần gọi: báo người dùng trước. whisper chạy ~1× thời gian thực: âm thanh dài hơn 2 phút thì chạy synchro-video captions riêng một lần (timeout 600) rồi ghi tệp phụ đề vào props thay cho "auto".
Giấy phép Remotion: chỉ dựng 4 mẫu này. Không dựng dự án / mã Remotion người dùng tải lên (điều khoản của Remotion cấm): nói lịch sự và đề nghị đưa nội dung vào props của mẫu phù hợp.
</video_kit>`;

/** Khối cho lượt này: chỉ khi có run_code chạy trên image workspace (nơi có synchro-video) và người dùng nhờ dựng video. */
export function videoTurn(i: { typed: string; code: boolean; workspace: boolean }): string {
  if (!i.code || !i.workspace || process.env.SYNCHRO_VIDEOKIT === "0" || /(?:^|\s)#novideokit\b/.test(i.typed)) return "";
  return wantsVideo(i.typed) ? VIDEO_KIT : "";
}
