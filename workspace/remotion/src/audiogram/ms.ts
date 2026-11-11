// Mẫu gốc cố định FPS = 30; Synchro dựng 30 hoặc 60 khung/giây nên số khung tính theo fps của composition.
export const msToFrame = (time: number, fps: number) => Math.floor((time / 1000) * fps);
