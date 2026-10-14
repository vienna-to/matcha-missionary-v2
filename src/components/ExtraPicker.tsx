"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import {
  extraAmount,
  type ExtraDraft,
  type ExtraMode,
} from "@/lib/order-steps";
import { roundUpExtra } from "@/lib/pricing";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

/**
 * "Tips" block for taking a round-up or tip with an order: None, Round up,
 * +$1, +$2 or a custom amount, the method it was paid with, and the three
 * numbers that matter (items total, tip, total collected). The tip is never
 * added to item prices or revenue.
 *
 * `owed` is what the customer owes at checkout (items total, plus sales tax
 * if it is added at checkout), which is what Round up rounds.
 *
 * `orderMethod` is "" when the order has no payment method of its own (a free
 * order). Then there is nothing for the tip to default to, so the tip's method
 * must be chosen explicitly.
 */
export default function ExtraPicker({
  owed,
  draft,
  onChange,
  orderMethod,
  className,
}: {
  owed: number;
  draft: ExtraDraft;
  onChange: (d: ExtraDraft) => void;
  orderMethod: PaymentMethod | "";
  className?: string;
}) {
  const [customText, setCustomText] = useState(draft.custom > 0 ? String(draft.custom) : "");
  const amount = extraAmount(draft, owed);
  const roundUp = roundUpExtra(owed);
  const roundUpDisabled = roundUp === 0;

  const choose = (mode: ExtraMode) => onChange({ ...draft, mode });

  return (
    <div className={cn("space-y-3 rounded-xl border border-cream-200 p-3", className)}>
      <div className="t-display text-sm">Tips (optional)</div>

      {/* Equal-width tracks that wrap to a second row instead of overflowing. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2">
        <ModeButton active={draft.mode === "none"} onClick={() => choose("none")}>
          None
        </ModeButton>
        <ModeButton
          active={draft.mode === "round"}
          disabled={roundUpDisabled}
          onClick={() => choose("round")}
        >
          Round up
        </ModeButton>
        <ModeButton active={draft.mode === "plus1"} onClick={() => choose("plus1")}>
          +$1
        </ModeButton>
        <ModeButton active={draft.mode === "plus2"} onClick={() => choose("plus2")}>
          +$2
        </ModeButton>
        <ModeButton active={draft.mode === "custom"} onClick={() => choose("custom")}>
          Custom
        </ModeButton>
      </div>
      <p className="t-caption -mt-1 text-xs text-matcha-900/60">
        {roundUpDisabled
          ? "Round up is off because the total is already a whole dollar."
          : `Round up adds ${formatMoney(roundUp)}.`}
      </p>

      {draft.mode === "custom" ? (
        <label className="flex items-center gap-2">
          <span className="t-caption text-sm text-matcha-900/70">Amount $</span>
          <input
            inputMode="decimal"
            value={customText}
            onChange={(e) => {
              const text = e.target.value.replace(/[^0-9.]/g, "");
              setCustomText(text);
              const n = parseFloat(text);
              onChange({ ...draft, custom: Number.isFinite(n) ? n : 0 });
            }}
            placeholder="0.00"
            autoComplete="off"
            className="h-12 w-32 rounded-xl border border-cream-200 bg-white px-3 text-lg tabular-nums"
          />
        </label>
      ) : null}

      {amount > 0 ? (
        <label className="flex flex-wrap items-center gap-2">
          <span className="t-caption text-sm text-matcha-900/70">Tip paid with</span>
          <Select
            value={draft.method}
            onChange={(e) => onChange({ ...draft, method: e.target.value as PaymentMethod | "" })}
            className={cn(
              "h-11 w-auto min-w-40 text-sm",
              orderMethod === "" && draft.method === "" && "border-red-400",
            )}
          >
            {orderMethod === "" ? (
              <option value="">Choose a method</option>
            ) : (
              <option value="">Same as order ({PAYMENT_METHOD_LABELS[orderMethod]})</option>
            )}
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <dl className="t-caption space-y-1 rounded-lg bg-cream-100 px-3 py-2 text-sm">
        <Row label="Items total" value={formatMoney(owed)} />
        <Row label="Tip" value={formatMoney(amount)} />
        <Row label="Total collected" value={formatMoney(owed + amount)} strong />
      </dl>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", strong && "font-semibold text-matcha-900")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-12 min-w-0 whitespace-nowrap rounded-xl border-2 px-2 text-sm font-semibold transition-colors active:scale-[0.98]",
        disabled
          ? "cursor-not-allowed border-dashed border-cream-200 bg-cream-100 text-matcha-900/35"
          : active
            ? "border-matcha-500 bg-matcha-500 text-white"
            : "border-cream-300 bg-white text-matcha-900 hover:border-matcha-400",
      )}
    >
      {children}
    </button>
  );
}
