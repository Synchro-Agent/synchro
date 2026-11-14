// Điểm vào instrumentation của Next: mọi việc lúc khởi động nằm ở instrumentation-node.ts (chỉ runtime Node).
// Next thay process.env.NEXT_RUNTIME bằng hằng lúc biên dịch nên gói Edge bỏ hẳn lệnh import bên dưới. Trước đây phần thân nằm ngay ở đây,
// sau một lệnh return sớm: gói Edge vẫn lần theo mọi import("./app/…") và bản dev in khoảng 300 KB cảnh báo "Node.js module … Edge Runtime"
// cho mỗi yêu cầu, làm mỗi yêu cầu chậm thêm 1–3 giây (máy giả lập dev:mock).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./instrumentation-node")).registerNode();
}
