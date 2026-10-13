"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { isLive, useSyncStatus } from "@/lib/supabase/sync-status";
import { cn } from "@/lib/utils";

/**
 * Small per-screen connection indicator. Green "Live" = realtime is connected
 * and we've read from the server in the last few seconds. Amber
 * "Reconnecting" = this tablet may be behind. Red = orders submitted here
 * that haven't been saved yet. Tap to force a reconnect + full refresh.
 */
export default function SyncBadge({ className }: { className?: string }) {
  const status = useSyncStatus();
  const { syncNow } = useStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!status.enabled) return null;

  const live = isLive(status, now);
  const secs = status.lastOkAt ? Math.max(0, Math.round((now - status.lastOkAt) / 1000)) : null;
  const unsaved = status.unsynced > 0;

  const tone = unsaved
    ? "bg-red-100 text-red-900"
    : live
      ? "bg-matcha-100 text-matcha-900"
      : "bg-amber-100 text-amber-900";
  const dot = unsaved ? "bg-red-500" : live ? "bg-matcha-500" : "bg-amber-500 animate-pulse";
  const label = unsaved
    ? `${status.unsynced} order${status.unsynced === 1 ? "" : "s"} not saved · retrying`
    : live
      ? "Live"
      : "Reconnecting…";

  return (
    <button
      type="button"
      onClick={() => syncNow?.()}
      title={
        secs === null
          ? "Tap to refresh"
          : `Last synced ${secs}s ago. Tap to reconnect and refresh.`
      }
      className={cn(
        "t-display inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]",
        tone,
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      {label}
    </button>
  );
}
