export class ZipTooBig extends Error {}
export const ZIP_MAX_BYTES: number;
export const ZIP_MAX_ENTRIES: number;
export const SKILL_ZIP_MAX: number;
export function declaredSize(zip: unknown): number;
export function measureZip(zip: unknown, max?: number, maxEntries?: number): Promise<number>;
export function readCapped(f: unknown, cap: number, budget?: { left: number }): Promise<{ data: Buffer; cut: boolean }>;
