"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { Event } from "@/lib/types";

/**
 * Add, change or remove an event's revenue share % (charity / collab partner)
 * after the event was created. 0 or empty removes it.
 */
export default function RevenueShareEditor({ event }: { event: Event }) {
  const { dispatch } = useStore();
  const current = event.donationPct ?? 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const start = () => {
    setDraft(current > 0 ? String(current) : "");
    setEditing(true);
  };

  const parsed = draft.trim() === "" ? 0 : Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;

  const save = () => {
    if (!valid) return;
    if (parsed !== current) {
      dispatch({ type: "UPDATE_EVENT", id: event.id, patch: { donationPct: parsed } });
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm text-matcha-900/70">
        <span>
          Revenue share: {current > 0 ? `${current}% of revenue` : "none"}
        </span>
        <Button variant="outline" size="sm" onClick={start}>
          <Pencil className="h-3.5 w-3.5" /> {current > 0 ? "Edit revenue share" : "Add revenue share"}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor="revenue-share-pct" className="text-matcha-900/70">
        Revenue share %
      </label>
      <Input
        id="revenue-share-pct"
        type="number"
        inputMode="decimal"
        min="0"
        max="100"
        step="1"
        autoFocus
        className="w-24"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
        placeholder="e.g. 10"
      />
      <Button type="submit" size="sm" disabled={!valid}>
        Save
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {valid ? null : <span className="text-xs text-red-700">Enter 0 to 100</span>}
    </form>
  );
}
