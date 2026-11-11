Thư viện chạy bên trong artifact (khung iframe cô lập), tải từ npm, giữ nguyên bản phát hành:
react 18.3.1, react-dom 18.3.1 (MIT) · @babel/standalone 7.29.11 (MIT) · recharts 2.15.4 (MIT) · prop-types 15.8.1 (MIT)
@tailwindcss/browser 4.3.3 (MIT) · lucide-react 0.460.0 (ISC)
echarts 6.1.0 (Apache-2.0, dist/echarts.min.js, sha512 khớp npm): biểu đồ của bộ thiết kế (data-sx-chart) và import "echarts" trong React; chỉ tải khi trang dùng

Ngoại lệ duy nhất, tệp ĐÓNG GÓI chứ không chép nguyên bản (three 0.169.0 không có bản UMD chạy trong khung):
synchro-3d-1.0.0.js — dựng bằng node scripts/build-vendor-3d.mjs từ đúng các gói ghim trong scripts/vendor-3d/package-lock.json (sha512 của npm) với esbuild 0.25.12;
dựng lại ra cùng từng byte (sha384 ghi trong app/artkit.ts, SYNCHRO_3D). Gồm three 0.169.0, @react-three/fiber 8.18.0, @react-three/drei 9.122.0
(chỉ Environment, Float, Lightformer, MeshTransmissionMaterial được dùng), @shadergradient/react 2.4.20, đều MIT. React / ReactDOM lấy từ trang, không đóng gói lần hai.
Chỉ tải khi artifact import three / @react-three/* / shadergradient hoặc có data-sx-shader. Không có bản CDN: khung không với tới Synchro thì nền 3D để lớp CSS dự phòng.
Đổi mã nguồn hay phiên bản gói thì đổi tên tệp (synchro-3d-1.0.1.js…) vì /vendor được lưu đệm vĩnh viễn (immutable).

Thư viện cho khung xem trước tệp (Word, Excel, PowerPoint) và xuất ảnh, cũng chạy trong khung cô lập:
jszip 3.10.1 (MIT, chọn MIT trong giấy phép kép MIT / GPL-3.0) · mammoth 1.8.0 (BSD-2-Clause) · xlsx 0.18.5 (Apache-2.0) · html-to-image 1.11.11 (MIT)
pdfjs-dist 3.11.174 (Apache-2.0), bản legacy: xem trước PDF

Thư viện của trang Synchro (không chạy trong artifact), tải khi cần:
pptxgenjs 4.0.1 (MIT, bản pptxgen.bundle.js kèm JSZip): xuất bản trình bày thành PowerPoint (app/deckpptx.ts)
