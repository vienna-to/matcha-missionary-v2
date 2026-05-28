import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton Supabase browser client. When env vars are absent, `getClient()`
 * returns null and the app falls back to the localStorage adapter (so the
 * demo works without any backend setup).
 */
let cached: SupabaseClient | null | undefined;

export function getClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (typeof window === "undefined") return (cached = null);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return (cached = null);
  cached = createClient(url, anon, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

// Local session storage for the workspace code (so a returning device skips pairing).
const PAIRING_KEY = "matcha-missionary:pairing:v1";

export type PairingState = { workspaceId: string; code: string };

export function loadPairing(): PairingState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PAIRING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PairingState;
  } catch {
    return null;
  }
}

export function savePairing(p: PairingState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAIRING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function clearPairing(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PAIRING_KEY);
  } catch {
    /* ignore */
  }
}
