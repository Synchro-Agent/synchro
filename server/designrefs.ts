// Mẫu tham chiếu cho một lượt thiết kế: chọn 3 mẫu theo đề bài, trộn token, trả ảnh mẫu cho model dựng và người chấm.
import "server-only";
import type { DesignRef, StyleTurn, StyleTurnInput } from "../shared/designrefs";

export async function styleForTurn(_i: StyleTurnInput): Promise<StyleTurn | null> {
  return null;
}
export async function turnImages(_t: StyleTurn, _widths: number[]): Promise<{ label: string; jpeg: Buffer }[]> {
  return [];
}
export function getRef(_id: string): DesignRef | null {
  return null;
}
