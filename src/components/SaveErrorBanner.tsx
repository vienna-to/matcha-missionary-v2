"use client";

import { AlertTriangle, X } from "lucide-react";
import { dismissSaveError, useSaveErrors } from "@/lib/supabase/save-errors";

/**
 * Persistent red alert for saves that lost data (for example an extra or a
 * free reason because the database is missing a column). Stays until the
 * person dismisses it, so a busy pop-up never hides it.
 */
export default function SaveErrorBanner() {
  const errors = useSaveErrors();
  if (errors.length === 0) return null;
  return (
    <div className="space-y-2 px-4 pt-3 md:px-8" role="alert">
      {errors.map((e) => (
        <div
          key={e.id}
          className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="t-caption min-w-0 flex-1 break-words">{e.message}</div>
          <button
            type="button"
            onClick={() => dismissSaveError(e.id)}
            className="shrink-0 rounded-lg p-1 text-red-900/70 hover:bg-red-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
