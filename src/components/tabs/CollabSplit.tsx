"use client";

import { useState } from "react";
import { Handshake, Pencil } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { collabPending, collabSplitFor, parseCollabFields } from "@/lib/collab-split";
import { useStore } from "@/lib/store";
import type { Event } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

const fieldText = (n: number | undefined) => (n === undefined ? "" : String(n));

/**
 * Collab profit / expense split for one event: the partner's profit-split % and
 * the dollars they put toward ingredients, then both take-home numbers. Can be
 * added, changed or removed at any time. `profit` is the event's profit as shown
 * on the Event Summary (revenue minus its costs).
 */
export default function CollabSplit({ event, profit, revenue }: { event: Event; profit: number; revenue: number }) {
  const { dispatch } = useStore();
  const split = collabSplitFor(event, profit);
  const pending = collabPending(revenue);
  const [editing, setEditing] = useState(false);
  const [pctText, setPctText] = useState("");
  const [contribText, setContribText] = useState("");

  const parsed = parseCollabFields(pctText, contribText);
  const valid = parsed.ok && parsed.value !== null;

  const start = () => {
    setPctText(fieldText(event.collabProfitPct));
    setContribText(fieldText(event.collabContribution));
    setEditing(true);
  };

  const save = () => {
    if (!parsed.ok || parsed.value === null) return;
    dispatch({ type: "UPDATE_EVENT", id: event.id, patch: parsed.value });
    setEditing(false);
  };

  const remove = () => {
    dispatch({
      type: "UPDATE_EVENT",
      id: event.id,
      patch: { collabProfitPct: undefined, collabContribution: undefined },
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <Card data-testid="collab-split">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Handshake className="h-4 w-4 text-matcha-600" /> Collab split
          </div>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="space-y-1">
              <span className="block text-matcha-900/70">Partner profit share %</span>
              <Input
                id="collab-pct"
                aria-label="Partner profit share %"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="any"
                autoFocus
                className="w-32"
                value={pctText}
                onChange={(e) => setPctText(e.target.value)}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder="e.g. 40"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-matcha-900/70">Partner ingredient contribution $</span>
              <Input
                id="collab-contribution"
                aria-label="Partner ingredient contribution $"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className="w-40"
                value={contribText}
                onChange={(e) => setContribText(e.target.value)}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder="e.g. 50"
              />
            </label>
            <Button type="submit" size="sm" disabled={!valid}>
              Save
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {split ? (
              <Button type="button" variant="outline" size="sm" onClick={remove}>
                Remove collab
              </Button>
            ) : null}
          </div>
          {!parsed.ok && parsed.pctError ? <p className="text-xs text-red-700">Profit share must be 0 to 100.</p> : null}
          {!parsed.ok && parsed.contributionError ? <p className="text-xs text-red-700">Contribution must be a dollar amount of 0 or more.</p> : null}
          <p className="text-xs text-matcha-900/60">
            Partner take-home = profit × share % − their contribution. Your take-home = profit − partner take-home.
          </p>
        </form>
      </Card>
    );
  }

  if (!split) {
    return (
      <div className="flex items-center gap-2 text-sm text-matcha-900/70" data-testid="collab-split">
        <span>Collab split: none</span>
        <Button variant="outline" size="sm" onClick={start}>
          <Handshake className="h-3.5 w-3.5" /> Add collab split
        </Button>
      </div>
    );
  }

  const row = (label: string, value: string, opts?: { strong?: boolean; testid?: string; muted?: boolean }) => (
    <div className={cn("flex items-baseline justify-between gap-4", opts?.muted && "text-matcha-900/70")}>
      <dt className={cn(opts?.strong && "font-semibold")}>{label}</dt>
      <dd className={cn("tabular-nums", opts?.strong && "font-semibold")} data-testid={opts?.testid}>
        {value}
      </dd>
    </div>
  );

  return (
    <Card data-testid="collab-split">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Handshake className="h-4 w-4 text-matcha-600" /> Collab split
        </span>
        <Button variant="outline" size="sm" onClick={start}>
          <Pencil className="h-3.5 w-3.5" /> Edit collab split
        </Button>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {row("Profit (revenue − costs)", formatMoney(split.profit), { testid: "collab-profit" })}
        {row(`Partner profit share (${split.splitPct}%)`, formatMoney(split.partnerShare), { muted: true, testid: "collab-share" })}
        {row("− Partner ingredient contribution", formatMoney(split.contribution), { muted: true, testid: "collab-contribution" })}
        <div className="border-t border-cream-200 pt-1.5">
          {row("Partner take-home", pending ? "—" : formatMoney(split.partnerTakeHome), { strong: true, testid: "collab-partner" })}
          {row("Your take-home", pending ? "—" : formatMoney(split.yourTakeHome), { strong: true, testid: "collab-you" })}
        </div>
      </dl>
      {pending ? (
        <p className="mt-2 text-xs text-matcha-900/60" data-testid="collab-pending">
          Take-home amounts appear once there are sales. The terms above are saved.
        </p>
      ) : split.partnerTakeHome < 0 ? (
        <p className="mt-2 text-xs text-amber-800">
          The contribution is more than the partner&apos;s share of the profit, so their take-home is negative.
        </p>
      ) : null}
    </Card>
  );
}
