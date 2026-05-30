"use client";

import { Button, Field, NumberField } from "@/components/ui";

/**
 * Inline editor for a per-item discount.
 *
 * Three input modes that stay in sync:
 *   - % off   → discount percentage (0–100)
 *   - final $ → user types the price they want; we back-solve the %
 *   - FREE    → sets pct to 100 in one tap
 *
 * `onPct` is fired on every change (the wrapped NumberField uses
 *  commit="change") so callers see live updates as the user types.
 *  Pass `undefined` from the parent's setter to mean "no discount" if you
 *  want to clear it; this component always emits a number.
 */
export function DiscountRow({
  unitPrice,
  pct,
  onPct,
  onClose,
}: {
  unitPrice: number;
  pct: number;
  onPct: (p: number) => void;
  onClose: () => void;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const finalPrice = unitPrice * (1 - clamped / 100);
  return (
    <div className="mt-2 grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2 rounded-xl bg-cream-50 p-2">
      <Field label="% off">
        <NumberField
          min={0}
          max={100}
          step={1}
          value={clamped}
          commit="change"
          onChange={(p) => onPct(Math.min(100, Math.max(0, p)))}
          className="h-8"
        />
      </Field>
      <Field label="final price ($)">
        <NumberField
          min={0}
          step="0.01"
          value={Number(finalPrice.toFixed(2))}
          commit="change"
          onChange={(p) => {
            if (unitPrice <= 0) return;
            const next = (1 - Math.min(unitPrice, Math.max(0, p)) / unitPrice) * 100;
            onPct(Math.min(100, Math.max(0, Math.round(next * 10) / 10)));
          }}
          className="h-8"
        />
      </Field>
      <Button
        size="sm"
        variant={clamped === 100 ? "primary" : "outline"}
        onClick={() => onPct(100)}
      >
        FREE
      </Button>
      <Button size="sm" variant="ghost" onClick={onClose}>
        ✓
      </Button>
    </div>
  );
}
