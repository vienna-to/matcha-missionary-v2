"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { DiscountRow } from "@/components/DiscountRow";
import ExtraPicker from "@/components/ExtraPicker";
import {
  COMBO_PRICE,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type IceAdjustment,
  type MenuItem,
  type MenuSnapshot,
  type PaymentMethod,
  type SugarAdjustment,
} from "@/lib/types";
import {
  hasDrinkAdjustments,
  resolveCreamName,
  resolveMilkChoices,
  resolveMilkName,
} from "@/lib/order-labels";
import { STEPS, stepIndex, type CartLine, type ExtraDraft, type Step } from "@/lib/order-steps";
import { cn, formatMoney } from "@/lib/utils";

export { STEPS, stepIndex };
export type { CartLine, Step };

const SUGAR_OPTIONS: Array<[SugarAdjustment, string]> = [
  ["less", "Less sweet"],
  ["normal", "Normal"],
  ["extra", "Extra sweet"],
  ["no_agave", "No agave"],
];
const ICE_OPTIONS: Array<[IceAdjustment, string]> = [
  ["light", "Light ice"],
  ["normal", "Normal ice"],
  ["extra", "Extra ice"],
];

type Props = {
  cart: CartLine[];
  snapshot: MenuSnapshot;
  total: number;
  /** Extra money (round-up / tip) chosen at the Payment step. */
  extra: ExtraDraft;
  setExtra: (d: ExtraDraft) => void;
  /** The extra resolved to dollars. */
  extraDollars: number;
  step: Step;
  /** Per-step "has real input" flags that drive the checkmarks. */
  checks: Record<Step, boolean>;
  /** Inline validation message (e.g. missing item / payment), or null. */
  notice: string | null;
  onStep: (s: Step) => void;
  customerName: string;
  setCustomerName: (s: string) => void;
  notes: string;
  setNotes: (s: string) => void;
  paymentMethod: PaymentMethod | "";
  setPaymentMethod: (p: PaymentMethod) => void;
  onUpdateLine: (cid: string, patch: Partial<CartLine>) => void;
  onRemoveLine: (cid: string) => void;
  onIncrement: (cid: string, delta: number) => void;
  onOpenCombo: () => void;
  onSubmit: () => void;
  helperMode: boolean;
  className?: string;
};

export default function OrderFlow(p: Props) {
  const { step, cart } = p;
  const nameRef = useRef<HTMLInputElement>(null);
  const idx = stepIndex(step);

  // Raise the keyboard as soon as the Name step appears. A layout effect runs
  // inside the same event turn as the tap that triggered the step change,
  // which is what iPad Safari needs to open the keyboard from focus().
  useLayoutEffect(() => {
    if (step === "name") nameRef.current?.focus();
  }, [step]);

  return (
    <div className={cn("flex flex-col rounded-2xl border border-cream-200 bg-white shadow-sm", p.className)}>
      <StepBar step={step} checks={p.checks} onStep={p.onStep} />

      <div className="flex-1 space-y-3 p-4">
        {p.notice ? (
          <div
            role="alert"
            className="rounded-xl border-2 border-red-400 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          >
            {p.notice}
          </div>
        ) : null}
        {step === "items" && <ItemsStep {...p} />}
        {step === "adjust" && <AdjustStep {...p} />}
        {step === "name" && (
          <div className="space-y-3">
            <Field label="customer name">
              <input
                ref={nameRef}
                value={p.customerName}
                onChange={(e) => p.setCustomerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    p.onStep("payment");
                  }
                }}
                enterKeyHint="next"
                autoComplete="off"
                autoCapitalize="words"
                autoCorrect="off"
                placeholder="who's it for?"
                className="h-16 w-full rounded-2xl border border-cream-200 bg-white px-4 text-2xl placeholder:text-matcha-900/40"
              />
            </Field>
          </div>
        )}
        {step === "payment" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-cream-100 px-4 py-3">
              <div className="t-display text-base">{p.customerName.trim() || "No name"}</div>
              <div className="t-caption text-sm text-matcha-900/70">
                {cart.reduce((s, l) => s + l.quantity, 0)} item
                {cart.reduce((s, l) => s + l.quantity, 0) === 1 ? "" : "s"} ·{" "}
                <span className="tabular-nums">{formatMoney(p.total)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {PAYMENT_METHODS.map((m) => {
                const active = p.paymentMethod === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => p.setPaymentMethod(m)}
                    className={cn(
                      "t-display min-h-16 rounded-2xl border-2 px-4 text-base transition-colors active:scale-[0.98]",
                      active
                        ? "border-matcha-500 bg-matcha-500 text-white"
                        : "border-cream-300 bg-white text-matcha-900 hover:border-matcha-400",
                    )}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                );
              })}
            </div>
            <ExtraPicker
              owed={p.total}
              draft={p.extra}
              onChange={p.setExtra}
              orderMethod={p.paymentMethod}
            />
          </div>
        )}
      </div>

      {/* Sticky action bar: always visible, always big. */}
      <div className="sticky bottom-0 flex items-center gap-2 rounded-b-2xl border-t border-cream-200 bg-white p-3">
        {idx > 0 ? (
          <Button
            variant="outline"
            className="h-14 w-14 shrink-0 px-0"
            aria-label="Back"
            onClick={() => p.onStep(STEPS[idx - 1].id)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        ) : null}
        <div className="min-w-0 shrink-0 px-1">
          <div className="t-display text-[10px] text-matcha-700">
            {step === "payment" && p.extraDollars > 0 ? "Collect" : "Total"}
          </div>
          <div className="text-xl font-semibold tabular-nums text-matcha-900">
            {formatMoney(step === "payment" ? p.total + p.extraDollars : p.total)}
          </div>
        </div>
        <div className="ml-auto flex-1">
          {step === "items" && (
            <Button
              size="lg"
              className="h-14 w-full text-base"
              disabled={cart.length === 0}
              onClick={() => p.onStep("adjust")}
            >
              Next: Adjustments <ChevronRight className="h-5 w-5" />
            </Button>
          )}
          {step === "adjust" && (
            <Button
              size="lg"
              className="h-14 w-full text-base"
              onClick={() => p.onStep("name")}
            >
              Next: Name <ChevronRight className="h-5 w-5" />
            </Button>
          )}
          {step === "name" && (
            <Button
              size="lg"
              className="h-14 w-full text-base"
              onClick={() => p.onStep("payment")}
            >
              Next: Payment <ChevronRight className="h-5 w-5" />
            </Button>
          )}
          {step === "payment" && (
            <Button
              size="lg"
              className="h-14 w-full text-base"
              onClick={p.onSubmit}
            >
              <Check className="h-5 w-5" /> Confirm order
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBar({
  step,
  checks,
  onStep,
}: {
  step: Step;
  checks: Record<Step, boolean>;
  onStep: (s: Step) => void;
}) {
  return (
    <ol className="sticky top-0 z-10 flex rounded-t-2xl border-b border-cream-200 bg-white p-1.5">
      {STEPS.map((s, i) => {
        const active = s.id === step;
        // A check means the step holds real input — not that it was viewed.
        const checked = checks[s.id];
        return (
          <li key={s.id} className="flex-1">
            <button
              type="button"
              onClick={() => onStep(s.id)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "t-display flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] transition-colors",
                active
                  ? "bg-matcha-500 text-white"
                  : "text-matcha-900 hover:bg-cream-100",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                  checked
                    ? active
                      ? "bg-white text-matcha-600"
                      : "bg-matcha-500 text-white"
                    : active
                      ? "bg-white/25"
                      : "bg-cream-200",
                )}
              >
                {checked ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Step 1: items
// ---------------------------------------------------------------------------

function lineMods(line: CartLine, item: MenuItem, snapshot: MenuSnapshot): string[] {
  const mods: string[] = [];
  if (hasDrinkAdjustments(item)) {
    const milk = resolveMilkName(line.milkChoiceId, item, snapshot.ingredients);
    if (milk) mods.push(milk);
    const cream = resolveCreamName(line.creamChoiceId, item, snapshot.ingredients);
    if (cream) mods.push(cream);
  }
  if (hasDrinkAdjustments(item) && line.sugarAdjustment && line.sugarAdjustment !== "normal") {
    mods.push(
      line.sugarAdjustment === "less"
        ? "less sweet"
        : line.sugarAdjustment === "extra"
          ? "extra sweet"
          : "no agave",
    );
  }
  if (hasDrinkAdjustments(item) && line.iceAdjustment && line.iceAdjustment !== "normal") {
    mods.push(line.iceAdjustment === "light" ? "light ice" : "extra ice");
  }
  if (line.specialRequests?.trim()) mods.push(`"${line.specialRequests.trim()}"`);
  return mods;
}

function lineTitle(line: CartLine, item: MenuItem, snapshot: MenuSnapshot): string {
  if (!line.isCombo) return item.name;
  const pastry = snapshot.menuItems.find((m) => m.id === line.comboPastryId);
  return `Combo: ${item.name} + ${pastry?.name ?? "?"}`;
}

function ItemsStep(p: Props) {
  return (
    <div className="space-y-3">
      {p.cart.length === 0 ? (
        <div className="rounded-xl border border-dashed border-cream-300 px-4 py-8 text-center">
          <div className="t-display text-sm">No items yet</div>
          <div className="t-caption mt-1 text-sm text-matcha-900/60">
            tap drinks on the menu to add them
          </div>
        </div>
      ) : (
        p.cart.map((line) => (
          <ItemLine
            key={line.cid}
            line={line}
            snapshot={p.snapshot}
            helperMode={p.helperMode}
            onUpdate={(patch) => p.onUpdateLine(line.cid, patch)}
            onRemove={() => p.onRemoveLine(line.cid)}
            onIncrement={(d) => p.onIncrement(line.cid, d)}
          />
        ))
      )}
      <Button variant="outline" className="h-12 w-full" onClick={p.onOpenCombo}>
        + Combo deal · {formatMoney(COMBO_PRICE)}
      </Button>
    </div>
  );
}

function ItemLine({
  line,
  snapshot,
  helperMode,
  onUpdate,
  onRemove,
  onIncrement,
}: {
  line: CartLine;
  snapshot: MenuSnapshot;
  helperMode: boolean;
  onUpdate: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
  onIncrement: (delta: number) => void;
}) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const item = snapshot.menuItems.find((m) => m.id === line.menuItemId);
  if (!item) return null;

  const mods = lineMods(line, item, snapshot);
  const unit = line.isCombo ? COMBO_PRICE : item.price;
  const fraction = Math.min(1, Math.max(0, (line.discountPct ?? 0) / 100));

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="t-display text-sm">{lineTitle(line, item, snapshot)}</div>
          {mods.length > 0 ? (
            <div className="t-caption mt-0.5 line-clamp-2 text-xs text-matcha-900/60">
              {mods.join(" · ")}
            </div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">
            {formatMoney(unit * (1 - fraction) * line.quantity)}
          </div>
          {fraction > 0 ? (
            <div className="t-caption text-[11px] text-matcha-700">
              {line.discountPct === 100 ? "FREE" : `${line.discountPct}% off`}
            </div>
          ) : null}
        </div>
      </div>
      {discountOpen && !helperMode ? (
        <DiscountRow
          unitPrice={unit}
          pct={line.discountPct ?? 0}
          onPct={(v) =>
            onUpdate({ discountPct: v > 0 ? Math.min(100, Math.max(0, v)) : undefined })
          }
          onClose={() => setDiscountOpen(false)}
          freeReason={line.freeReason}
          onFreeReason={(r) => onUpdate({ freeReason: r })}
        />
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 w-11 px-0" aria-label="Fewer" onClick={() => onIncrement(-1)}>
            <Minus className="h-4 w-4" />
          </Button>
          <div className="min-w-8 text-center text-base font-semibold tabular-nums">
            {line.quantity}
          </div>
          <Button variant="outline" className="h-11 w-11 px-0" aria-label="More" onClick={() => onIncrement(1)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          {helperMode ? null : (
            <Button
              variant={fraction > 0 ? "primary" : "ghost"}
              className="h-11 w-11 px-0"
              onClick={() => setDiscountOpen((s) => !s)}
              title="Discount"
            >
              <span className="t-display text-xs">%</span>
            </Button>
          )}
          <Button variant="ghost" className="h-11 w-11 px-0" aria-label="Remove" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: adjustments — inline, so nothing nested can close the order pop-up
// ---------------------------------------------------------------------------

function BigChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-12 rounded-xl border-2 px-4 text-sm font-semibold transition-colors active:scale-[0.98]",
        active
          ? "border-matcha-500 bg-matcha-500 text-white"
          : "border-cream-300 bg-white text-matcha-900 hover:border-matcha-400",
      )}
    >
      {children}
    </button>
  );
}

function AdjustStep(p: Props) {
  const milks = resolveMilkChoices(p.snapshot.ingredients);
  return (
    <div className="space-y-3">
      {p.cart.length === 0 ? (
        <div className="t-caption rounded-xl border border-dashed border-cream-300 px-4 py-6 text-center text-sm text-matcha-900/60">
          no items yet. add some on the Items step; adjustments will show up here.
        </div>
      ) : null}
      {p.cart.map((line) => {
        const item = p.snapshot.menuItems.find((m) => m.id === line.menuItemId);
        if (!item) return null;
        const isPastry = !hasDrinkAdjustments(item);
        const selectedMilk = line.milkChoiceId ?? item.defaultMilkId;
        return (
          <div key={line.cid} className="space-y-3 rounded-xl border border-cream-200 bg-cream-50/50 p-3">
            <div className="t-display text-sm">
              {line.quantity}× {lineTitle(line, item, p.snapshot)}
            </div>
            {isPastry ? null : (
              <>
                <div>
                  <div className="t-display mb-1.5 text-[11px] text-matcha-700">Milk</div>
                  <div className="flex flex-wrap gap-2">
                    {milks.map((m) => (
                      <BigChip
                        key={m.id}
                        active={selectedMilk === m.id}
                        onClick={() => p.onUpdateLine(line.cid, { milkChoiceId: m.id })}
                      >
                        {m.name}
                      </BigChip>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="t-display mb-1.5 text-[11px] text-matcha-700">Sugar</div>
                  <div className="flex flex-wrap gap-2">
                    {SUGAR_OPTIONS.map(([v, label]) => (
                      <BigChip
                        key={v}
                        active={line.sugarAdjustment === v}
                        onClick={() =>
                          p.onUpdateLine(line.cid, {
                            sugarAdjustment: line.sugarAdjustment === v ? undefined : v,
                          })
                        }
                      >
                        {label}
                      </BigChip>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="t-display mb-1.5 text-[11px] text-matcha-700">Ice</div>
                  <div className="flex flex-wrap gap-2">
                    {ICE_OPTIONS.map(([v, label]) => (
                      <BigChip
                        key={v}
                        active={line.iceAdjustment === v}
                        onClick={() =>
                          p.onUpdateLine(line.cid, {
                            iceAdjustment: line.iceAdjustment === v ? undefined : v,
                          })
                        }
                      >
                        {label}
                      </BigChip>
                    ))}
                  </div>
                </div>
              </>
            )}
            <Field label="special requests">
              <Input
                value={line.specialRequests ?? ""}
                onChange={(e) => p.onUpdateLine(line.cid, { specialRequests: e.target.value })}
                placeholder="e.g. extra hot, no foam"
                className="h-12"
              />
            </Field>
          </div>
        );
      })}
      <Field label="order notes (optional)">
        <Textarea rows={2} value={p.notes} onChange={(e) => p.setNotes(e.target.value)} />
      </Field>
    </div>
  );
}

