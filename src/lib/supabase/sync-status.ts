import { useSyncExternalStore } from "react";

/**
 * Connection health, kept outside React context on purpose: it changes every
 * poll tick (5s), and routing that through the store context would re-render
 * every screen. Only the little status badge subscribes.
 */
export type SyncSnapshot = {
  /** False in localStorage mode (no network sync to report on). */
  enabled: boolean;
  /** Realtime websocket is subscribed. */
  channelUp: boolean;
  /** Last time any read from Supabase succeeded (ms epoch, 0 = never). */
  lastOkAt: number;
  /** Orders submitted on this device that are not saved to the server yet. */
  unsynced: number;
};

const INITIAL: SyncSnapshot = { enabled: false, channelUp: false, lastOkAt: 0, unsynced: 0 };

let snap: SyncSnapshot = INITIAL;
const listeners = new Set<() => void>();

export function setSyncStatus(patch: Partial<SyncSnapshot>): void {
  const next = { ...snap, ...patch };
  if (
    next.enabled === snap.enabled &&
    next.channelUp === snap.channelUp &&
    next.lastOkAt === snap.lastOkAt &&
    next.unsynced === snap.unsynced
  ) {
    return;
  }
  snap = next;
  for (const l of listeners) l();
}

export function resetSyncStatus(): void {
  setSyncStatus({ ...INITIAL });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => INITIAL,
  );
}

/** A screen is "live" only if the websocket is up AND a read succeeded lately. */
export const LIVE_FRESH_MS = 12_000;

export function isLive(s: SyncSnapshot, now: number): boolean {
  return s.enabled && s.channelUp && now - s.lastOkAt < LIVE_FRESH_MS;
}
