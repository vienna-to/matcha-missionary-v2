"use client";

import { useEffect, useState } from "react";

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
 */
const STORAGE_KEY = "matcha-missionary:helper-mode:v1";
const URL_PARAM = "helper";

export function readInitialHelperMode(): boolean {
  if (typeof window === "undefined") return false;
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
        return true;
      }
      // Fall through — leave whatever was cached in place.
    }
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
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readInitialHelperMode());
  }, []);
  const set = (next: boolean) => {
    writeHelperMode(next);
    setOn(next);
  };
  return [on, set];
}
