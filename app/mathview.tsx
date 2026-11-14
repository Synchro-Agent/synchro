"use client";
// Công thức trong câu trả lời ($…$, $$…$$, \(…\), \[…\]). Tải riêng khi câu trả lời thật sự có công thức: KaTeX và phông chữ của nó khá nặng.
// trust mặc định tắt: \href, \includegraphics không chạy được nên chuỗi HTML KaTeX tạo ra an toàn để gắn. Lỗi cú pháp thì hiện nguyên nguồn.
import katex from "katex";
import "./vendor/katex.css";

export function MathView({ v, display }: { v: string; display?: boolean }) {
  let html = "";
  try { html = katex.renderToString(v, { displayMode: !!display, throwOnError: true, strict: "ignore", maxSize: 50, maxExpand: 500 }); } catch {}
  if (!html) return <code className="ic">{display ? `$$${v}$$` : `$${v}$`}</code>;
  const T = display ? "div" : "span";
  return <T className={display ? "md-math" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}
