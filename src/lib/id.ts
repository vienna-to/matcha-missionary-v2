import { customAlphabet, nanoid } from "nanoid";

/**
 * Generate a fresh ID for a new entity. Returns a UUID v4 — required because
 * the Supabase schema uses `uuid` primary keys. The optional `prefix` arg is
 * preserved for API compatibility but no longer included in the result.
 *
 * (Seed data still uses readable string IDs like "mi_classic" — those only
 * live in localStorage mode; the Supabase backend never sees them.)
 */
export function newId(prefix?: string): string {
  void prefix;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for ancient environments — produces a uuid-shaped string from nanoid.
  return `${nanoid(8)}-${nanoid(4)}-${nanoid(4)}-${nanoid(4)}-${nanoid(12)}`;
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeGen = customAlphabet(codeAlphabet, 6);

export function newWorkspaceCode(): string {
  return codeGen();
}

export function formatWorkspaceCode(c: string): string {
  return `MATCHA-${c}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
