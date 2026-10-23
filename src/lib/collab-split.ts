import type { Event } from "./types";

/**
 * Collab profit / expense split for an event.
 *
 *   profit             = revenue - costs        (the event's existing profit)
 *   partner take-home  = profit x split% - partner ingredient contribution
 *   your take-home     = profit - partner take-home
 *
 * The contribution is a dollar amount typed per event (the expense split is
 * decided ad hoc and does not always cover every ingredient), never a percentage.
 */
export type CollabSplit = {
  profit: number;
  splitPct: number;
  contribution: number;
  /** The partner's cut of the profit, before the contribution is taken off. */
  partnerShare: number;
  partnerTakeHome: number;
  yourTakeHome: number;
};

export function computeCollabSplit(profit: number, splitPct: number, contribution: number): CollabSplit {
  const partnerShare = profit * (splitPct / 100);
  const partnerTakeHome = partnerShare - contribution;
  return {
    profit,
    splitPct,
    contribution,
    partnerShare,
    partnerTakeHome,
    yourTakeHome: profit - partnerTakeHome,
  };
}

/** An event is a collab once a profit-split % or a partner contribution is set. */
export function isCollab(event: Pick<Event, "collabProfitPct" | "collabContribution">): boolean {
  return event.collabProfitPct !== undefined || event.collabContribution !== undefined;
}

/** The split for an event given its profit, or null when it is not a collab. */
export function collabSplitFor(
  event: Pick<Event, "collabProfitPct" | "collabContribution">,
  profit: number,
): CollabSplit | null {
  if (!isCollab(event)) return null;
  return computeCollabSplit(profit, event.collabProfitPct ?? 0, event.collabContribution ?? 0);
}

/** Parse a typed number: blank = undefined (not set); anything else must be a finite number in [min, max]. */
export function parseCollabInput(
  text: string,
  min: number,
  max: number,
): { ok: true; value: number | undefined } | { ok: false } {
  const t = text.trim();
  if (t === "") return { ok: true, value: undefined };
  const n = Number(t);
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}
