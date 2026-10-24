import type { Event } from "./types";

/**
 * Collab profit / expense split for an event.
 *
 *   profit             = revenue - costs        (the event's existing profit)
 *   partner take-home  = profit x split% - partner ingredient contribution
 *   your take-home     = profit - partner take-home      (a subtraction, never its own %)
 *
 * The contribution is a dollar amount typed per event (the expense split is
 * decided ad hoc and does not always cover every ingredient), never a percentage.
 *
 * Everything is worked out in whole cents and rounded once, so the two
 * take-homes ALWAYS add up to the profit shown, to the cent.
 */
export type CollabSplit = {
  /** Profit rounded to cents: the number the split works from and the number shown. */
  profit: number;
  splitPct: number;
  contribution: number;
  /** The partner's cut of the profit (rounded to cents), before the contribution is taken off. */
  partnerShare: number;
  partnerTakeHome: number;
  yourTakeHome: number;
};

/** Round a number of cents to a whole cent, halves away from zero, ignoring float noise (1997.4999999 is a half). */
function roundCents(cents: number): number {
  return Math.sign(cents) * Math.round(Number(Math.abs(cents).toFixed(6)));
}

export function computeCollabSplit(profit: number, splitPct: number, contribution: number): CollabSplit {
  const profitC = roundCents(profit * 100);
  const shareC = roundCents((profitC * splitPct) / 100);
  const contributionC = roundCents(contribution * 100);
  const partnerC = shareC - contributionC;
  const yourC = profitC - partnerC;
  return {
    profit: profitC / 100,
    splitPct,
    contribution: contributionC / 100,
    partnerShare: shareC / 100,
    partnerTakeHome: partnerC / 100,
    yourTakeHome: yourC / 100,
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

export type CollabFields =
  | { ok: false; pctError: boolean; contributionError: boolean }
  | { ok: true; value: { collabProfitPct: number; collabContribution: number } | null };

/**
 * The two typed collab inputs, validated once for every place that has them (the
 * New Event and Quick add dialogs and the Event Summary panel): the share is 0 to
 * 100, the contribution is a dollar amount of 0 or more. Both blank = not a collab
 * (value null); one blank = that half is 0.
 */
export function parseCollabFields(pctText: string, contributionText: string): CollabFields {
  const pct = parseCollabInput(pctText, 0, 100);
  const contribution = parseCollabInput(contributionText, 0, Infinity);
  if (!pct.ok || !contribution.ok) return { ok: false, pctError: !pct.ok, contributionError: !contribution.ok };
  if (pct.value === undefined && contribution.value === undefined) return { ok: true, value: null };
  return { ok: true, value: { collabProfitPct: pct.value ?? 0, collabContribution: contribution.value ?? 0 } };
}
