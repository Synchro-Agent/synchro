"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { AuthUser } from "./auth";
import type { TraceItem } from "./transpile";
import { ls } from "./userscope";

// trace: dấu vết công cụ (chuẩn Synchro) gửi lại ở lượt sau; stopped: người dùng đã bấm Dừng giữa chừng.
import type { CriticEntry } from "./critic";
export type Msg = { role: "user" | "ai"; text: string; pick?: { id: string; label: string }[]; done?: boolean; trace?: TraceItem[]; stopped?: boolean; files?: string[]; fids?: Record<string, string>; like?: 1 | -1; time: number; searched?: boolean; sys?: string; skills?: string[]; libs?: { key: string; label: string; forced?: boolean; skills: string[] }[]; tools?: string[]; outs?: { id: string; name: string; size: number; mime: string }[]; run?: string; prog?: string; via?: string;
  // Nhật ký làm việc của lượt (lời dẫn, công cụ, danh sách việc); steer: tin nhắn thêm đã ghép vào lượt đang chạy.
  // dur: thời gian câu trả lời đã chạy (ms), cho dòng tổng kết khi xong.
  parts?: import("./worklog").Part[]; plan?: import("./worklog").PlanItem[]; seq?: number; steer?: boolean; dur?: number };
// mixer: bàn trộn ngữ cảnh (tắt khối artifact / kết quả công cụ, chỉ gửi N tin gần nhất); compact: các tin trước "upto" đã nén thành tóm tắt;
// pins: tài liệu ghim (chữ đã đọc từ tệp, luôn có trong ngữ cảnh của đoạn chat). critic: kết quả hội đồng phản biện theo từng phiên bản artifact.
// named: người dùng tự đổi tên (không tự đặt tên nữa); titled: số tin của người dùng lúc Synchro tự đặt tên gần nhất.
export type Chat = { id: number; title: string; named?: boolean; titled?: number; msgs: Msg[]; pinned?: boolean; project?: number; inc?: boolean; studio?: "design" | "slides" | "docs";
  mixer?: { artifacts?: boolean; tools?: boolean; recent?: number }; compact?: { upto: number; text: string; at: number }; pins?: { name: string; text: string }[];
  critic?: Record<string, CriticEntry>;
  // browser: Synchro đã thao tác trình duyệt trong đoạn chat này (hiện nút mở lại khung trình duyệt cạnh đoạn chat).
  browser?: boolean };
export type Project = { id: number; name: string; desc: string; ins?: string; pinned?: boolean; archived?: boolean; upd?: number; mem?: { id: number; content: string }[]; ctx?: { id: number; name: string; kind: "file" | "text"; text?: string; chars?: number; size?: number; chunks?: string[] }[] };

const defs = new Map<string, unknown>();
const cache = new Map<string, unknown>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function read(k: string): unknown {
  if (cache.has(k)) return cache.get(k);
  let v = defs.get(k);
  try {
    const s = ls.get("p:" + k);
    if (s !== null) v = JSON.parse(s);
  } catch {}
  cache.set(k, v);
  return v;
}

/** Đọc cài đặt ngoài React (lúc gửi tin): giá trị đã lưu, không có thì mặc định. */
export const readPref = <T,>(k: string, d: T): T => { const v = read(k); return v === undefined ? d : (v as T); };
export function usePref<T>(k: string, d: T): [T, (v: T | ((o: T) => T)) => void] {
  if (!defs.has(k)) defs.set(k, d);
  const v = useSyncExternalStore(subscribe, () => (typeof window === "undefined" ? defs.get(k) : read(k)), () => defs.get(k)) as T;
  const set = useCallback((n: T | ((o: T) => T)) => {
    const cur = read(k) as T;
    const nv = typeof n === "function" ? (n as (o: T) => T)(cur) : n;
    cache.set(k, nv);
    ls.set("p:" + k, JSON.stringify(nv));
    emit();
  }, [k]);
  return [v, set];
}

export function resetPrefs() {
  cache.clear();
  ls.keys().filter((k) => k.startsWith("p:")).forEach((k) => ls.remove(k));
  emit();
}

// Gọi sau khi đổi tài khoản (setUserScope): bỏ giá trị đã nhớ để mọi nơi đọc lại cài đặt của tài khoản mới.
export function reloadPrefs() {
  cache.clear();
  emit();
}

export type AppApi = {
  say: (m: string) => void;
  upgrade: () => void;
  openSettings?: (tab?: string) => void;
  goCode: () => void;
  ask: (text: string) => void;
  confirm: (title: string, text: string, ok: string, fn: () => void) => void;
  chats: Chat[];
  exportData: () => void;
  wipe: (what: "all" | "chats") => void;
  close: () => void;
  me: AuthUser | null;
  setMe: (u: AuthUser | null) => void;
  logout: () => void;
};
export const AppCtx = createContext<AppApi>({
  say: () => {}, ask: () => {}, upgrade: () => {}, goCode: () => {}, confirm: () => {}, chats: [], exportData: () => {}, wipe: () => {}, close: () => {},
  me: null, setMe: () => {}, logout: () => {},
});
export const useApp = () => useContext(AppCtx);

// Giữ phần tử hiển thị thêm một khoảng để chạy animation thoát.
export function useLinger<T>(value: T | null, ms = 160): { value: T | null; closing: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) { setKept(value); return; }
    const t = setTimeout(() => setKept(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return { value: value ?? kept, closing: value === null && kept !== null };
}

export const VOICE_LANG: Record<string, string> = {
  English: "en-US", "English (India)": "en-IN", "English (United Kingdom)": "en-GB", "Chinese (Mandarin)": "zh-CN", Cantonese: "zh-HK",
  French: "fr-FR", "French (Canada)": "fr-CA", German: "de-DE", Vietnamese: "vi-VN",
};
export const VOICE_RATE: Record<string, number> = { Slow: 0.8, Normal: 1, Fast: 1.3 };
export const initials = (n: string) => (n.trim().split(/\s+/).map((w) => w[0]).join("").slice(-2) || "?").toUpperCase();
