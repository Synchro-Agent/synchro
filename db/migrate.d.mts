import type Database from "better-sqlite3";
export type Migration = { n: number; name: string; kind: "sql" | "columns"; file: string };
export type MigrateResult = { from: number; to: number; applied: { name: string; changed: number }[] };
export const MIGRATIONS_DIR: () => string;
export function listMigrations(dir?: string): Migration[];
export function sqlTargets(sql: string): { create: string[]; drop: string[] };
export function migrate(d: Database.Database, opts?: { dir?: string; log?: (s: string) => void }): MigrateResult;
