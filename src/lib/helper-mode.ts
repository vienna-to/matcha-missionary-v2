"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * "Helper mode" restricts the UI to the tabs a booth helper actually needs
 * (Live Orders + Barista Queue), hiding menu, finance, event summary, and
 * anything that reveals revenue or lets them touch our master data.
 *
 * This is a **client-side** gate, not a security boundary — RLS is off and
 * any workspace member could bypass it via devtools. It exists so trusted
 * outside helpers can share a device without accidentally seeing our books.
 *
 * The flag is per-device (localStorage) and is *not* synced across the
 * workspace. A helper enters via a share link (`?helper=1`) generated in
 * Settings; the param is stripped after read so refreshes preserve state.
 *
 * All consumers subscribe to a shared listener set so a toggle in Settings
 * updates every mounted component (AppShell, BaristaQueue, LiveOrders, …)
 * without a manual page reload.
 */
const STORAGE_KEY = "matcha-missionary:helper-mode:v1";
const URL_PARAM = "helper";

// Fan-out subscription list — every mounted useHelperMode() adds itself here
// and gets notified when writeHelperMode() runs.
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

// URL-param handling runs once per tab, on first hook mount. Idempotent so
// repeated calls (React strict-mode double-invoke, remounts) are harmless.
let urlProcessed = false;
function ensureUrlProcessed() {
  if (urlProcessed || typeof window === "undefined") return;
  urlProcessed = true;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(URL_PARAM);
    if (raw !== null) {
      const on = raw === "1" || raw === "true";
      // URL can only ENABLE helper mode — turning it off requires the
      // workspace code via Settings, so a helper can't sneak out by typing
      // ?helper=0 into the address bar.
      const url = new URL(window.location.href);
      url.searchParams.delete(URL_PARAM);
      window.history.replaceState(null, "", url.toString());
      if (on) {
        window.localStorage.setItem(STORAGE_KEY, "1");
        notify();
      }
    }
  } catch {}
}

function readCurrent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHelperMode(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {}
  notify();
}

function subscribe(cb: () => void): () => void {
  ensureUrlProcessed();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** URL a full-mode user can share so their helper opens the app in
 *  restricted view. Includes the workspace code so the helper auto-joins. */
export function buildHelperShareUrl(workspaceCode: string): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", workspaceCode);
  url.searchParams.set(URL_PARAM, "1");
  return url.toString();
}

export function useHelperMode(): [boolean, (on: boolean) => void] {
  // useSyncExternalStore keeps every mounted consumer in sync with the shared
  // localStorage flag — a toggle in Settings re-renders AppShell, BaristaQueue,
  // LiveOrders, EditOrderModal, etc. in the same tick, no reload needed.
  const on = useSyncExternalStore(
    subscribe,
    readCurrent,
    () => false, // server / SSR default
  );
  const set = useCallback((next: boolean) => {
    writeHelperMode(next);
  }, []);
  return [on, set];
}
