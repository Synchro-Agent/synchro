// Gửi yêu cầu bắt đầu lượt (trình duyệt). Bản đang tắt để nhường bản mới (deploy xanh/lam, server/drain.ts) trả 503 kèm Retry-After:
// chờ đúng chừng đó rồi gửi lại (nginx đã chuyển sang bản mới), người dùng không thấy lỗi. 503 khác (máy bận) không có Retry-After nên trả nguyên.
export async function postTurn(url: string, init: RequestInit, tries = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    const after = Number(r.headers.get("retry-after"));
    if (r.status !== 503 || !(after > 0) || i >= tries || init.signal?.aborted) return r;
    await new Promise<void>((ok) => { setTimeout(ok, Math.min(after, 30) * 1000); });
  }
}
