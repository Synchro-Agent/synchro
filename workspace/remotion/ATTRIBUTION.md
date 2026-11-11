# Nguồn và giấy phép của dự án video Remotion

Dự án này nằm trong image sandbox ở `/opt/remotion`. Model gọi nó bằng lệnh `synchro-video`.

## Remotion (framework)

- Gói: `remotion` và các gói `@remotion/*`, đều ghim đúng bản **4.0.539**. `package-lock.json` ghi mã băm sha512 của từng gói.
- Giấy phép: [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md). Giấy phép miễn phí (Free License) dành cho cá nhân, tổ chức vì lợi nhuận có tối đa 3 nhân viên, và tổ chức phi lợi nhuận. Công ty của chủ dịch vụ Synchro chỉ có 1 người nên thuộc diện miễn phí. Phần ghi chú đầy đủ ở `docs/remotion-license.md`.
- Không truyền `licenseKey` cho Remotion. Remotion v4 chỉ gửi sự kiện sử dụng tới remotion.pro khi có khóa này (kể cả khóa `"free-license"`).
- Điều khoản phải giữ: Synchro chỉ dựng các mẫu của chính nó, hoặc composition do model viết hộ người dùng. Synchro **không** dựng dự án Remotion do người dùng tải lên (FAQ giấy phép của Remotion cấm việc này).
- Chrome Headless Shell 157.0.8080.0 là bản Remotion 4.0.539 đã thử. Tệp tải từ `remotion.media`, mã băm sha256 ghi trong `workspace/Dockerfile`.

## Bốn mẫu

| id | Nguồn | Commit | Giấy phép | Đã đổi |
|---|---|---|---|---|
| `tiktok` | [remotion-dev/template-tiktok](https://github.com/remotion-dev/template-tiktok) (monorepo `packages/template-tiktok`) | 1d2bffac65db4938d2ac24884c0013624e6146e8 | Remotion License (package.json ghi UNLICENSED, nằm trong monorepo Remotion) | Phụ đề lấy từ props thay vì fetch tệp. fps theo props. Thay TheBoldFont (không có chữ Việt) bằng Be Vietnam Pro Black. Thêm nền ảnh Ken Burns, hook, nhạc nền. Bỏ `sample-video.mp4`, `sub.mjs` và whisper medium.en. |
| `next-tailwind` | [remotion-dev/template-next-app-dir-tailwind](https://github.com/remotion-dev/template-next-app-dir-tailwind) (lệnh `create-video --next`) | b3339aedce09ea173fa4e3ee9fa4a148ce9083b1 | Remotion License | Giữ Rings, TextFade và Tailwind v4. Mở rộng thành 7 loại cảnh của video giới thiệu sản phẩm. Bỏ logo Next.js, phần Next.js / Lambda và `@remotion/google-fonts`. |
| `audiogram` | [remotion-dev/template-audiogram](https://github.com/remotion-dev/template-audiogram) | dee9f3619127b8853a1e6cf8882332d9d332c32d | Remotion License | Tiêu đề, tên chương trình và bìa thành props (bỏ tập "Ep 550" và `podcast-cover.jpeg` cố định). fps động. Cắt đoạn bằng `clip`. Dùng phông cục bộ. Bỏ `dialogue.wav`. |
| `github-unwrapped` | [remotion-dev/github-unwrapped](https://github.com/remotion-dev/github-unwrapped) (repo riêng, không phải mẫu của create-video) | ece8397df97eb8e0578f8825058da2bf650b1f7d | Mã: MIT | Lấy hình hành tinh (StandardPlanet), dải màu nền, màu khung, cách lưới đóng góp và cột năng suất sáng dần. Mốc thời gian tính bằng giây × fps. Số liệu là dữ liệu bất kỳ, không riêng của GitHub. |

### Không dùng từ github-unwrapped

- Nhạc và hiệu ứng âm thanh: giấy phép SmartSound chỉ cấp cho GitHubUnwrapped.com.
- Octocat, logo và nhãn hiệu GitHub.
- Phông Mona Sans.
- Phông "Seven Segment.ttf" và ảnh PNG chữ số 7 đoạn, vì không rõ giấy phép. Chữ số 7 đoạn được vẽ lại bằng SVG trong `src/unwrapped/parts.tsx`.

## Phông

Be Vietnam Pro, Inter, Plus Jakarta Sans, Space Grotesk, Playfair Display và JetBrains Mono đều theo giấy phép SIL OFL 1.1. Phông lấy từ google/fonts, commit bbda7253…, có mã băm trong Dockerfile. Lúc build, phông được chép từ `/usr/share/fonts/truetype/synchro` vào `public/fonts`.

## whisper.cpp

[ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) v1.9.5 theo giấy phép MIT. Mô hình `ggml-small.bin` (OpenAI Whisper, MIT) lấy từ Hugging Face `ggerganov/whisper.cpp`, revision 5359861c….
