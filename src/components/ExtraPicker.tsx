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
 * "Extra" block for taking a round-up or tip with an order: None, Round up,
 * +$1, +$2 or a custom amount, the method it was paid with, and the three
 * numbers that matter (items total, extra, total collected). The extra is
 * never added to item prices or revenue.
 *
 * `owed` is what the customer owes at checkout (items total, plus sales tax
 * if it is added at checkout), which is what Round up rounds.
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

  const choose = (mode: ExtraMode) => onChange({ ...draft, mode });

  return (
    <div className={cn("space-y-3 rounded-xl border border-cream-200 p-3", className)}>
      <div className="t-display text-sm">Extra (optional)</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <ModeButton active={draft.mode === "none"} onClick={() => choose("none")}>
          None
        </ModeButton>
        <ModeButton
          active={draft.mode === "round"}
          disabled={roundUp === 0}
          onClick={() => choose("round")}
        >
          Round up{roundUp > 0 ? ` +${formatMoney(roundUp)}` : ""}
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
        <label className="flex items-center gap-2">
          <span className="t-caption text-sm text-matcha-900/70">Extra paid with</span>
          <Select
            value={draft.method}
            onChange={(e) => onChange({ ...draft, method: e.target.value as PaymentMethod | "" })}
            className="h-11 w-auto min-w-40 text-sm"
          >
            <option value="">
              Same as order{orderMethod ? ` (${PAYMENT_METHOD_LABELS[orderMethod]})` : ""}
            </option>
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
        <Row label="Extra" value={formatMoney(amount)} />
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
        "min-h-12 rounded-xl border-2 px-2 text-sm font-semibold transition-colors active:scale-[0.98]",
        active
          ? "border-matcha-500 bg-matcha-500 text-white"
          : "border-cream-300 bg-white text-matcha-900 hover:border-matcha-400",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}
