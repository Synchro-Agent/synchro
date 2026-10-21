"use client";
import { create } from "zustand";

export type Panel = { name: string; lang: string; code: string; tab: "code" | "preview"; runnable: boolean; fix?: number };

type DevState = {
  panel: Panel | null;
  setPanel: (p: Panel | null) => void;
  encVer: number; // tăng khi tokenizer thật tải xong để UI tính lại
  bumpEnc: () => void;
};
export const useDev = create<DevState>((set) => ({
  panel: null,
  setPanel: (panel) => set({ panel }),
  encVer: 0,
  bumpEnc: () => set((s) => ({ encVer: s.encVer + 1 })),
}));
