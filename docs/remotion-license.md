# Giấy phép Remotion trong Synchro

Synchro dựng video bằng 4 mẫu Remotion có sẵn trong image sandbox. Các mẫu nằm ở `/opt/remotion`, gọi bằng lệnh `synchro-video`; mã nguồn ở `workspace/remotion`.

## Synchro dùng giấy phép miễn phí

Chủ dịch vụ xác nhận công ty **chỉ có 1 người**. Remotion cho dùng miễn phí khi tổng số người không quá 3.

Bản đã kiểm tra ngày 2026-11-11:

- **https://www.remotion.dev/license**: Free License dành "For individuals and companies of up to 3 people", kèm "Unlimited commercial use".
- **LICENSE.md** (https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) cho dùng miễn phí khi bạn là cá nhân, "a for-profit organization with up to 3 employees", tổ chức phi lợi nhuận, hoặc đang dùng thử chưa thương mại.
- **FAQ giấy phép**, mục "Can single-person companies use the Free License?": công ty một người vẫn được dùng giấy phép miễn phí kể cả khi đã đăng ký pháp nhân, miễn tổng số người không quá 3.

Free License cho phép dùng thương mại, tự động hóa và SaaS. FAQ cũng cho phép dịch vụ dùng AI viết mã Remotion thay người dùng rồi dựng ra video, và khách hàng của dịch vụ không cần mua giấy phép.

## Điều phải giữ

1. **Không dựng dự án Remotion người dùng tải lên.** FAQ viết: "it is not allowed to let users bring or upload their own Remotion code". Hướng dẫn cho model (`app/coderun.ts`, `app/videokit.ts`) bắt model từ chối việc này và đề nghị đưa nội dung vào props của mẫu có sẵn. `synchro-video` chỉ dựng 4 composition trong bundle đóng sẵn.
2. **Số người phải giữ ở mức 3 trở xuống.** Remotion tính cả freelancer và agency làm cùng dự án. Bản nháp Remotion 5.0 (PR #3750) tính cả người làm hợp đồng. Nếu số người vượt 3, phải mua Company License:
   - "Remotion for Creators": 25 USD một người một tháng.
   - "Remotion for Automators": 0,01 USD một lần dựng, tối thiểu 100 USD một tháng.
3. **Không truyền `licenseKey`.** Từ bản 4.0.409, khi có `licenseKey` (kể cả `"free-license"`), Remotion gửi sự kiện sử dụng tới remotion.pro, thử lại 3 lần, mỗi lần chờ 10 giây. Khi không có khóa, bản v4 không gửi gì và không in cảnh báo. Kiểm thử `tests/api/remotion-image.test.mjs` canh việc này.
4. **Phiên bản ghim là 4.0.539.** Muốn nâng cấp, phải đọc lại LICENSE.md của bản mới, vì Remotion 5.0 có thay đổi điều khoản.

## Tài sản của bên thứ ba không đưa vào

Danh sách đầy đủ ở `workspace/remotion/ATTRIBUTION.md`. Các thứ dưới đây bị bỏ:

- Nhạc SmartSound của github-unwrapped, vì giấy phép chỉ cấp cho GitHubUnwrapped.com.
- Octocat và logo GitHub, vì là nhãn hiệu.
- Logo Next.js.
- TheBoldFont, vì không có chữ tiếng Việt.
- Phông "Seven Segment", vì không rõ giấy phép.
