// Icon các công cụ Speech: Phosphor Light như phần còn lại của app (app/phosphor-data.ts). Rê chuột vào thẻ / mục chứa icon thì icon biến
// sang một icon cùng nghĩa (morphicons, app/morph.tsx) — vd. chữ Aa thành loa (đọc văn bản), quả địa cầu thành dịch (lồng tiếng). Dùng chung cho
// trang chính, tab trên điện thoại và mục con ở thanh bên.
import React from "react";
import { HoverMorph } from "../morph";
import type { SpeechTool } from "./data";

type P = { size?: number };
const mk = (a: string, b: string) => {
  const C = ({ size = 20 }: P) => <HoverMorph a={a} b={b} size={size} />;
  C.displayName = a;
  return C;
};

export const TextToSpeech = mk("text-aa", "speaker-high");
export const Dialogue = mk("chats-circle", "chat-circle-dots");
export const Agent = mk("headset", "robot");
export const SpeechToText = mk("waveform", "text-align-left");
export const VoiceDesign = mk("magic-wand", "sparkle");
export const VoiceClone = mk("user-sound", "users");
export const SoundEffects = mk("speaker-simple-high", "sparkle");
export const Isolator = mk("funnel-simple", "waveform");
export const VoiceChanger = mk("user-switch", "arrows-clockwise");
export const Dubbing = mk("globe-hemisphere-west", "translate");
export const Audiobook = mk("book-open", "headphones");
export const Podcast = mk("microphone-stage", "broadcast");
export const Home = mk("squares-four", "house-simple");
export const Music = mk("music-notes", "vinyl-record");
export const Dictionary = mk("book-bookmark", "text-aa");
export const AudioNative = mk("browser", "play-circle");
export const Voices = mk("users-three", "user-sound");

export const TOOL_ICON: Record<SpeechTool, (p: P) => React.ReactNode> = {
  home: Home, tts: TextToSpeech, changer: VoiceChanger, agent: Agent, voices: Voices, create: VoiceClone, stt: SpeechToText, dub: Dubbing,
  music: Music, sfx: SoundEffects, isolate: Isolator, dict: Dictionary, native: AudioNative, studio: Audiobook,
};
