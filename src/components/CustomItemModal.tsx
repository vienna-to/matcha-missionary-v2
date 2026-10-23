"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, Modal, Select } from "@/components/ui";
import {
  CUSTOM_BASE_PRICE,
  CUSTOM_TOPPING_PRICE,
  MILK_ONLY_ID,
  customComponents,
  customCostParts,
  customItemId,
  customItemPrice,
  isValidCustomSpec,
  type CustomSpec,
} from "@/lib/custom-item";
import type { MenuSnapshot } from "@/lib/types";
import { formatMoney, formatPct } from "@/lib/utils";

export const EMPTY_SPEC: CustomSpec = { baseIds: [], toppingIds: [] };

/**
 * Builder for an off-menu drink: pick 1+ bases and 0+ toppings. The dropdowns
 * list only ingredients flagged as a base (teas) or topping in Menu Manager,
 * plus "Milk only" for a drink with no tea. Milk is added automatically to a
 * tea drink, so it is not a choice here. Used by order entry, Edit Order and
 * the combo picker; it only edits a CustomSpec.
 */
export function CustomBuilder({
  snapshot,
  cupSizeOz,
  helperMode,
  spec,
  onChange,
  priceLabel = "price",
  priceOverride,
}: {
  snapshot: MenuSnapshot;
  cupSizeOz?: number;
  /** Helpers see the price but never costs or margin. */
  helperMode: boolean;
  spec: CustomSpec;
  onChange: (s: CustomSpec) => void;
  priceLabel?: string;
  /** Show this price instead of the drink's own (the combo price). */
  priceOverride?: number;
}) {
  const { bases, toppings, milk, unassignedPrepared } = useMemo(() => customComponents(snapshot), [snapshot]);
  const valid = isValidCustomSpec(spec);
  const price = priceOverride ?? customItemPrice(spec.toppingIds.length);
  const cost = customCostParts(spec, snapshot, cupSizeOz).total;
  const margin = price > 0 ? (price - cost) / price : null;

  const baseOptions = [
    ...bases.map((c) => ({ id: c.ingredient.id, name: c.ingredient.name })),
    ...(milk ? [{ id: MILK_ONLY_ID, name: "Milk only" }] : []),
  ];
  const nameOf = (id: string) =>
    id === MILK_ONLY_ID
      ? "Milk only"
      : [...bases, ...toppings].find((c) => c.ingredient.id === id)?.ingredient.name ?? "?";

  const addBase = (id: string) =>
    // "Milk only" and teas exclude each other: milk only means no tea.
    onChange({
      ...spec,
      baseIds:
        id === MILK_ONLY_ID
          ? [MILK_ONLY_ID]
          : [...spec.baseIds.filter((b) => b !== MILK_ONLY_ID), id],
    });

  return (
    <div className="space-y-4">
      <p className="t-caption text-xs text-matcha-900/60">
        pick at least one base. price is {formatMoney(CUSTOM_BASE_PRICE)} plus{" "}
        {formatMoney(CUSTOM_TOPPING_PRICE)} per topping; bases do not change the price. A tea drink
        includes milk automatically.
      </p>
      <Picker
        label="Bases"
        placeholder="Add a base…"
        empty="No bases set up. In Menu Manager, Ingredients, mark each tea as a base."
        options={baseOptions.filter((o) => !spec.baseIds.includes(o.id))}
        hasAny={baseOptions.length > 0}
        selected={spec.baseIds.map((id) => ({ id, name: nameOf(id) }))}
        onAdd={addBase}
        onRemove={(id) => onChange({ ...spec, baseIds: spec.baseIds.filter((b) => b !== id) })}
      />
      <Picker
        label="Toppings"
        placeholder="Add a topping…"
        empty="No toppings set up. In Menu Manager, Ingredients, mark each cream or purée as a topping."
        options={toppings
          .filter((c) => !spec.toppingIds.includes(c.ingredient.id))
          .map((c) => ({ id: c.ingredient.id, name: c.ingredient.name }))}
        hasAny={toppings.length > 0}
        selected={spec.toppingIds.map((id) => ({ id, name: nameOf(id) }))}
        onAdd={(id) => onChange({ ...spec, toppingIds: [...spec.toppingIds, id] })}
        onRemove={(id) => onChange({ ...spec, toppingIds: spec.toppingIds.filter((t) => t !== id) })}
      />
      {unassignedPrepared.length > 0 ? (
        <p className="t-caption text-xs text-matcha-900/60" data-testid="unassigned-prepared">
          Not offered: {unassignedPrepared.map((i) => i.name).join(", ")} (prepared, no custom drink role). Set a
          role in Menu Manager to use {unassignedPrepared.length === 1 ? "it" : "them"} here.
        </p>
      ) : null}
      <div className="t-caption space-y-1 rounded-xl bg-matcha-50 px-3 py-2 text-xs text-matcha-900/80">
        <div className="flex items-center justify-between">
          <span>{priceLabel}</span>
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
    </div>
  );
}

function Picker({
  label,
  placeholder,
  empty,
  options,
  hasAny,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  empty: string;
  options: Array<{ id: string; name: string }>;
  hasAny: boolean;
  selected: Array<{ id: string; name: string }>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="t-display mb-1.5 text-[11px] text-matcha-700">{label}</div>
      {hasAny ? (
        <Select
          aria-label={`Add ${label.toLowerCase().replace(/s$/, "")}`}
          value=""
          disabled={options.length === 0}
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
          }}
          className="h-11"
        >
          <option value="">{options.length === 0 ? "All added" : placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      ) : (
        <p className="t-caption text-xs text-matcha-900/60">{empty}</p>
      )}
      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-matcha-500 py-1 pl-3 pr-1.5 text-sm font-medium text-white"
            >
              {s.name}
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() => onRemove(s.id)}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-matcha-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function CustomItemModal({
  snapshot,
  cupSizeOz,
  helperMode,
  onAdd,
  onClose,
}: {
  snapshot: MenuSnapshot;
  cupSizeOz?: number;
  helperMode: boolean;
  onAdd: (menuItemId: string) => void;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState<CustomSpec>(EMPTY_SPEC);
  return (
    <Modal open onClose={onClose} title="Custom drink">
      <div className="space-y-4">
        <CustomBuilder
          snapshot={snapshot}
          cupSizeOz={cupSizeOz}
          helperMode={helperMode}
          spec={spec}
          onChange={setSpec}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="h-12"
            disabled={!isValidCustomSpec(spec)}
            onClick={() => onAdd(customItemId(spec))}
          >
            Add custom drink
          </Button>
        </div>
      </div>
    </Modal>
  );
}
