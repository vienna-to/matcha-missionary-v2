"use client";

import { Field, Input } from "@/components/ui";
import { parseCollabFields } from "@/lib/collab-split";

/**
 * The two collab inputs for a form that sets them while creating an event: the
 * partner's profit share % and their ingredient contribution in dollars. Both
 * optional; validation is parseCollabFields, shared with the Event Summary panel.
 */
export default function CollabInputs({
  pctText,
  contributionText,
  onPctChange,
  onContributionChange,
  lowercase = false,
}: {
  pctText: string;
  contributionText: string;
  onPctChange: (v: string) => void;
  onContributionChange: (v: string) => void;
  lowercase?: boolean;
}) {
  const parsed = parseCollabFields(pctText, contributionText);
  const label = (s: string) => (lowercase ? s.toLowerCase() : s);
  return (
    <>
      <Field
        label={label("Partner profit share % (optional)")}
        className="col-span-2"
        hint="Collab: the partner's share of the profit, 0 to 100."
      >
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          step="any"
          value={pctText}
          onChange={(e) => onPctChange(e.target.value)}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          placeholder="e.g. 40"
        />
      </Field>
      <Field
        label={label("Partner ingredient contribution $ (optional)")}
        className="col-span-2"
        hint="Dollars the partner puts toward ingredients (not a percentage)."
      >
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={contributionText}
          onChange={(e) => onContributionChange(e.target.value)}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          placeholder="e.g. 50"
        />
      </Field>
      {!parsed.ok && parsed.pctError ? (
        <p className="col-span-2 text-xs text-red-700">Profit share must be 0 to 100.</p>
      ) : null}
      {!parsed.ok && parsed.contributionError ? (
        <p className="col-span-2 text-xs text-red-700">Contribution must be a dollar amount of 0 or more.</p>
      ) : null}
    </>
  );
}
