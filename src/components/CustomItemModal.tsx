"use client";

import { useMemo, useState } from "react";
import { Button, Modal } from "@/components/ui";
import {
  CUSTOM_BASE_PRICE,
  CUSTOM_TOPPING_PRICE,
  componentCost,
  customComponents,
  customItemId,
  customItemPrice,
  isValidCustomSpec,
  type CustomComponent,
} from "@/lib/custom-item";
import type { MenuSnapshot } from "@/lib/types";
import { cn, formatMoney, formatPct } from "@/lib/utils";

/**
 * Builder for an off-menu drink: pick 1+ bases and 0+ toppings from the
 * ingredients already in the system. Used by both order entry and Edit Order;
 * it only returns the id of the custom item, the order flow does the rest.
 */
export default function CustomItemModal({
  snapshot,
  cupSizeOz,
  helperMode,
  onAdd,
  onClose,
}: {
  snapshot: MenuSnapshot;
  cupSizeOz?: number;
  /** Helpers see the price but never costs or margin. */
  helperMode: boolean;
  onAdd: (menuItemId: string) => void;
  onClose: () => void;
}) {
  const { bases, toppings } = useMemo(() => customComponents(snapshot), [snapshot]);
  const [baseIds, setBaseIds] = useState<string[]>([]);
  const [toppingIds, setToppingIds] = useState<string[]>([]);

  const toggle = (ids: string[], set: (v: string[]) => void, id: string) =>
    set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const spec = { baseIds, toppingIds };
  const valid = isValidCustomSpec(spec);
  const price = customItemPrice(toppingIds.length);
  const chosen = [...bases, ...toppings].filter((c) =>
    [...baseIds, ...toppingIds].includes(c.ingredient.id),
  );
  const cost = chosen.reduce((sum, c) => sum + componentCost(c, cupSizeOz), 0);
  const margin = price > 0 ? (price - cost) / price : null;

  return (
    <Modal open onClose={onClose} title="Custom drink">
      <div className="space-y-4">
        <p className="t-caption text-xs text-matcha-900/60">
          pick at least one base. price is {formatMoney(CUSTOM_BASE_PRICE)} plus{" "}
          {formatMoney(CUSTOM_TOPPING_PRICE)} per topping; bases do not change the price.
        </p>
        <Group
          label="Bases"
          empty="No bases found. A base is a tea, milk or water that a menu drink's recipe uses."
          items={bases}
          selected={baseIds}
          onToggle={(id) => toggle(baseIds, setBaseIds, id)}
        />
        <Group
          label="Toppings"
          empty="No toppings found. A topping is a cream or purée that a menu drink's recipe uses."
          items={toppings}
          selected={toppingIds}
          onToggle={(id) => toggle(toppingIds, setToppingIds, id)}
        />
        <div className="t-caption space-y-1 rounded-xl bg-matcha-50 px-3 py-2 text-xs text-matcha-900/80">
          <div className="flex items-center justify-between">
            <span>price</span>
            <span className="text-sm font-semibold tabular-nums" data-testid="custom-price">
              {formatMoney(price)}
            </span>
          </div>
          {helperMode ? null : (
            <div className="flex items-center justify-between">
              <span>cost</span>
              <span className="tabular-nums" data-testid="custom-cost">
                {formatMoney(cost)}
                {margin !== null && valid ? ` · ${formatPct(margin)} margin` : ""}
              </span>
            </div>
          )}
        </div>
        {valid ? null : (
          <p role="alert" className="t-caption text-xs font-semibold text-amber-800">
            Pick at least one base.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-12" disabled={!valid} onClick={() => onAdd(customItemId(spec))}>
            Add custom drink
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Group({
  label,
  empty,
  items,
  selected,
  onToggle,
}: {
  label: string;
  empty: string;
  items: CustomComponent[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="t-display mb-1.5 text-[11px] text-matcha-700">{label}</div>
      {items.length === 0 ? (
        <p className="t-caption text-xs text-matcha-900/60">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((c) => {
            const on = selected.includes(c.ingredient.id);
            return (
              <button
                key={c.ingredient.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(c.ingredient.id)}
                className={cn(
                  "min-h-11 rounded-xl border-2 px-3 text-sm font-semibold transition-colors active:scale-[0.98]",
                  on
                    ? "border-matcha-500 bg-matcha-500 text-white"
                    : "border-cream-300 bg-white text-matcha-900 hover:border-matcha-400",
                )}
              >
                {c.ingredient.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
