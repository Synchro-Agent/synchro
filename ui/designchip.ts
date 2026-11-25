"use client";
// Chip "Kiểu: …" của ô soạn tin, giữ theo từng đoạn chat trên trình duyệt này: phần nhỏ nạp cùng trang chủ (đọc chip
// khi gửi, đếm thẻ trong ô soạn). Bảng chọn phong cách và giao diện chip nạp sau (designstyleui.tsx).
import { useSyncExternalStore } from "react";

export type DesignChip = { kind: "mine" | "follow"; id: string; name: string };

// ---------------------------------------------------------------- chip theo đoạn chat
// Khóa "new": đoạn chat chưa có mã (đang soạn ở trang chủ); lượt gửi tạo đoạn chat mới chuyển chip sang mã vừa tạo
// (adoptNewChip). Gửi trong một đoạn chat có sẵn không lấy chip "new": ô soạn của đoạn đó không hiện chip ấy.
const KEY = "sx-design-chip";
const subs = new Set<() => void>();
let chips: Record<string, DesignChip> = {};
let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    chips = raw ? (JSON.parse(raw) as Record<string, DesignChip>) : {};
  } catch {
    // Trình duyệt chặn bộ nhớ trang (ẩn danh, chặn cookie): chip chỉ sống trong tab này.
    chips = {};
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(chips));
  } catch {
    // Không ghi được bộ nhớ trang: chip vẫn còn tới khi đóng tab.
  }
  subs.forEach((f) => f());
}
function setChip(key: string, c: DesignChip | null) {
  load();
  if (c) chips = { ...chips, [key]: c };
  else {
    const next = { ...chips };
    delete next[key];
    chips = next;
  }
  save();
}
/** Chip của một đoạn chat (khóa "new" cho đoạn chưa tạo) và hàm đặt / bỏ chip. */
export function useDesignChip(key: string): [DesignChip | null, (c: DesignChip | null) => void] {
  const c = useSyncExternalStore((f) => {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, () => {
    load();
    return chips[key] ?? null;
  }, () => null);
  return [c, (v) => setChip(key, v)];
}
/** Lượt gửi vừa tạo đoạn chat mới từ ô soạn ở trang chủ: chip đặt ở đó thuộc về đoạn chat này. */
export function adoptNewChip(chat: number) {
  load();
  const c = chips.new;
  if (!c) return;
  setChip("new", null);
  setChip(String(chat), c);
}
/** Phong cách gửi kèm lượt của đoạn chat này (chip đang hiện ở ô soạn của nó). */
export function designStyleFor(chat: number): { kind: "mine" | "follow"; id: string } | undefined {
  load();
  const c = chips[String(chat)];
  return c ? { kind: c.kind, id: c.id } : undefined;
}
