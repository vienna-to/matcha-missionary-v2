import { useSyncExternalStore } from "react";

/**
 * Errors the user must see: a save that lost data (for example an extra or a
 * free reason, because the database is missing a column). Kept outside React
 * context like sync-status so writers can report without a hook.
 */
export type SaveError = { id: string; message: string; at: number };

let errors: SaveError[] = [];
const listeners = new Set<() => void>();
const EMPTY: SaveError[] = [];

function emit() {
  for (const l of listeners) l();
}

/** Show a message until the user dismisses it. Identical messages collapse. */
export function reportSaveError(message: string): void {
  if (errors.some((e) => e.message === message)) return;
  console.error(`[save error] ${message}`);
  errors = [...errors, { id: `${Date.now()}-${errors.length}`, message, at: Date.now() }];
  emit();
}

export function dismissSaveError(id: string): void {
  errors = errors.filter((e) => e.id !== id);
  emit();
}

export function clearSaveErrors(): void {
  if (errors.length === 0) return;
  errors = [];
  emit();
}

export function getSaveErrors(): SaveError[] {
  return errors;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSaveErrors(): SaveError[] {
  return useSyncExternalStore(subscribe, () => errors, () => EMPTY);
}

// ---------- recognising a missing column / table ----------

export type NewColumn =
  | "tip_amount"
  | "tip_payment_method"
  | "list_price"
  | "price_charged"
  | "free_reason";

const NEW_COLUMNS: NewColumn[] = [
  "tip_amount",
  "tip_payment_method",
  "list_price",
  "price_charged",
  "free_reason",
];

/** Which of the new columns an error says is missing (PostgREST PGRST204 or
 *  Postgres 42703), or [] when the error is about something else. */
export function missingColumns(error: unknown): NewColumn[] {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return [];
  const msg = String(e.message ?? "");
  // A check constraint that does not know a newer free reason yet (for example
  // "friend" before migration-free-reason-friend.sql) is the same situation:
  // the database cannot take this value, and it must not be dropped silently.
  if (e.code === "23514" && msg.includes("free_reason")) return ["free_reason"];
  const looksMissing =
    e.code === "PGRST204" ||
    e.code === "42703" ||
    /schema cache|does not exist/i.test(msg);
  if (!looksMissing) return [];
  return NEW_COLUMNS.filter((c) => msg.includes(c));
}

/** The event_extras table is missing (PGRST205 / 42P01). */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.code === "PGRST205" ||
    e.code === "42P01" ||
    /relation .* does not exist|could not find the table/i.test(String(e.message ?? ""))
  );
}

/** PostgREST "column not in schema cache" (PGRST204) / Postgres "undefined column" (42703). */
function isMissingColumnError(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return "";
  const msg = String(e.message ?? "");
  const looksMissing =
    e.code === "PGRST204" || e.code === "42703" || /schema cache|does not exist/i.test(msg);
  return looksMissing ? msg : "";
}

/** The ingredients.custom_role column is missing (migration-add-ingredient-custom-role.sql not run). */
export function isMissingRoleColumn(error: unknown): boolean {
  return isMissingColumnError(error).includes("custom_role");
}

/** ingredients.kind / ingredients.sub_recipe are missing (migration-add-prepared-ingredients.sql not run). */
export function isMissingPreparedColumn(error: unknown): boolean {
  return /sub_recipe|['"]kind['"]/.test(isMissingColumnError(error));
}

export const ROLE_MIGRATION_HINT =
  "Run supabase/migration-add-ingredient-custom-role.sql in the Supabase SQL editor. Until then the role only lasts on this device (it is lost on reload) and the custom drink builder guesses from ingredient names.";

export const PREPARED_MIGRATION_HINT =
  "Run supabase/migration-add-prepared-ingredients.sql in the Supabase SQL editor. Until then a prepared ingredient exists only on this device and is lost on reload, so do not use it in drinks you rely on.";

export const MIGRATION_HINT =
  "Run supabase/migration-order-item-prices.sql, supabase/migration-order-tips-and-extras.sql, supabase/migration-submit-order-v2.sql and supabase/migration-free-reason-friend.sql in the Supabase SQL editor.";
