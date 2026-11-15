"use client";

import { useEffect } from "react";
import { Mark } from "../ui/brand";
import { reportError } from "../ui/errorreport";

// Lỗi khi hiển thị một trang: thay màn hình trắng "Application error". Phần đang gõ đã nằm trong bản nháp (draft.ts), tải lại trang là có lại.
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error(error); reportError(error, "page"); }, [error]);
  return (
    <main className="err-page" role="alert">
      <Mark size={30} />
      <h1>Synchro gặp lỗi khi hiển thị trang này</h1>
      <p>Đoạn chat và phần bạn đang gõ vẫn còn. Tải lại trang để dùng tiếp.</p>
      <div className="err-acts">
        <button className="btn dark" onClick={() => location.reload()}>Tải lại trang</button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- tải lại toàn trang có chủ đích: trang vừa lỗi, không giữ trạng thái client cũ */}
        <a className="btn" href="/">Đoạn chat mới</a>
      </div>
    </main>
  );
}
