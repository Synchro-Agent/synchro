"use client";
// Tách khỏi brainui.tsx (nặng, tải chậm khi mở Bộ não) vì việc nạp nền chạy ngay từ khi mở app.
import { useEffect, useRef } from "react";
import type { Chat } from "./store";

/**
 * Tự nạp các đoạn chat cũ đang nằm trong trình duyệt lên bộ não (không có nút bấm): mỗi lần 10 đoạn, cách nhau 20 giây, đoạn đã gửi
 * được nhớ trong trình duyệt. Không gửi đoạn chat ẩn danh; máy chủ bỏ qua khi người dùng tắt học.
 */
export function useBrainSync(chats: Chat[], on: boolean) {
  const ref = useRef(chats);
  ref.current = chats;
  useEffect(() => {
    if (!on) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | null = null;
    const KEY = "bn:synced";
    const read = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return new Set<string>(); } };
    const run = async () => {
      const done = read();
      const todo = ref.current.filter((c) => !c.inc && !done.has(String(c.id)) && c.msgs.some((m) => m.role === "user" && m.text?.trim())).slice(0, 10);
      if (todo.length) {
        try {
          const r = await fetch("/api/brain/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chats: todo.map((c) => ({ id: String(c.id), title: c.title, msgs: c.msgs.filter((m) => m.text?.trim() && !m.failed).map((m) => ({ role: m.role, text: m.text })) })) }) });
          const j = r.ok ? await r.json() : null;
          if (j && !j.off) { for (const c of todo) done.add(String(c.id)); try { localStorage.setItem(KEY, JSON.stringify([...done].slice(-5000))); } catch {} }
          if (!j || j.off) return;
        } catch { return; }
      }
      if (!stop && todo.length) timer = setTimeout(run, 20_000);
    };
    timer = setTimeout(run, 8000);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [on, chats.length]);
}
