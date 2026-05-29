"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, Field, Input, NumberField, TextField } from "@/components/ui";
import { useStore } from "@/lib/store";
import { defaultItemCost, defaultItemMargin, ingredientCostPerCanonical } from "@/lib/calc";
import { compareMenuItems, type Ingredient, type InventoryPurchase } from "@/lib/types";
import { UNIT_LABELS, UNIT_TABLE } from "@/lib/units";
import { formatMoney, formatPct } from "@/lib/utils";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function Finance() {
  const { state, dispatch } = useStore();
  const threshold = state.settings.lowMarginThresholdPct / 100;
  const activeItems = state.menuItems.filter((m) => m.active).sort(compareMenuItems);

  // Inventory section state — local-only form fields for the new-purchase row.
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState(0);
  const [newDate, setNewDate] = useState(todayLocal());

  const sortedPurchases = useMemo(
    () => [...state.inventoryPurchases].sort((a, b) => b.date.localeCompare(a.date)),
    [state.inventoryPurchases],
  );
  const totalInventory = sortedPurchases.reduce((s, p) => s + p.amount, 0);

  function addPurchase() {
    if (!newName.trim() || newAmount <= 0 || newDate.length !== 10) return;
    dispatch({
      type: "ADD_INVENTORY_PURCHASE",
      purchase: { name: newName.trim(), amount: newAmount, date: newDate },
    });
    setNewName("");
    setNewAmount(0);
    setNewDate(todayLocal());
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="t-display text-xl">Finance</h1>
        <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
          derived per-item economics. edit ingredients and items in menu manager.
        </p>
      </header>

      <Card>
        <h2 className="t-display mb-3 text-sm">Per-item costs</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="t-display text-left text-xs text-matcha-900/60">
                <th className="py-2 pr-4">Item</th>
                <th className="py-2 pr-4 text-right">Price</th>
                <th className="py-2 pr-4 text-right">Cost</th>
                <th className="py-2 pr-4 text-right">Profit</th>
                <th className="py-2 pr-4 text-right">Margin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {activeItems.map((item) => {
                const cost = defaultItemCost(item, state.ingredients);
                const margin = defaultItemMargin(item, state.ingredients);
                const profit = item.price - cost;
                const low = margin !== null && margin < threshold;
                return (
                  <tr key={item.id} className="border-t border-cream-100">
                    <td className="py-2 pr-4 font-medium lowercase">{item.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatMoney(item.price)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatMoney(cost)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatMoney(profit)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatPct(margin)}
                    </td>
                    <td className="py-2 pr-4">
                      {low ? (
                        <Badge variant="warning">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Low
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="t-display mb-3 text-sm">Ingredients</h2>
        <p className="t-caption mb-3 text-xs text-matcha-900/60">
          $/unit is derived from package price and amount. edit values in menu manager → ingredients.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="t-display text-left text-xs text-matcha-900/60">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4 text-right">Package $</th>
                <th className="py-2 pr-4 text-right">Amount</th>
                <th className="py-2 pr-4">Unit</th>
                <th className="py-2 pr-4 text-right">$/canonical</th>
              </tr>
            </thead>
            <tbody>
              {state.ingredients.map((ing: Ingredient) => {
                const perUnit = ingredientCostPerCanonical(ing);
                const canonical = UNIT_TABLE[ing.unit].canonical;
                return (
                  <tr key={ing.id} className="border-t border-cream-100">
                    <td className="py-2 pr-4 font-medium lowercase">{ing.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatMoney(ing.packagePrice)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {ing.packageAmount}
                    </td>
                    <td className="py-2 pr-4">{UNIT_LABELS[ing.unit]}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums text-matcha-900/70">
                      ${perUnit.toFixed(4)}/{UNIT_LABELS[canonical]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="t-display text-sm">Inventory & supplies</h2>
            <p className="t-caption mt-0.5 text-[11px] text-matcha-900/60">
              one-off purchases (bulk matcha, cups, signage). subtracted from event profit
              in the All Events summary view.
            </p>
          </div>
          <div className="text-right">
            <div className="t-display text-[10px] text-matcha-900/50">Total spent</div>
            <div className="text-base font-semibold tabular-nums">{formatMoney(totalInventory)}</div>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-[1fr_120px_140px_auto] gap-2">
          <Field label="item">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="what did you buy?"
            />
          </Field>
          <Field label="amount ($)">
            <NumberField min={0} step="0.01" value={newAmount} commit="change" onChange={setNewAmount} />
          </Field>
          <Field label="date">
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              onClick={addPurchase}
              disabled={!newName.trim() || newAmount <= 0}
              size="md"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>

        {sortedPurchases.length === 0 ? (
          <p className="t-caption text-xs text-matcha-900/60">
            no purchases logged yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="t-display text-left text-xs text-matcha-900/60">
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedPurchases.map((p) => (
                  <PurchaseRow
                    key={p.id}
                    purchase={p}
                    onPatch={(patch) =>
                      dispatch({ type: "UPDATE_INVENTORY_PURCHASE", id: p.id, patch })
                    }
                    onDelete={() =>
                      dispatch({ type: "DELETE_INVENTORY_PURCHASE", id: p.id })
                    }
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-cream-200">
                  <td className="py-2 pr-4 font-semibold">Total</td>
                  <td />
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                    {formatMoney(totalInventory)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PurchaseRow({
  purchase,
  onPatch,
  onDelete,
}: {
  purchase: InventoryPurchase;
  onPatch: (patch: Partial<InventoryPurchase>) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-t border-cream-100">
      <td className="py-1.5 pr-4">
        <TextField
          className="h-8 lowercase"
          value={purchase.name}
          onChange={(v) => onPatch({ name: v })}
        />
      </td>
      <td className="py-1.5 pr-4">
        <TextField
          className="h-8"
          type="date"
          value={purchase.date}
          onChange={(v) => onPatch({ date: v })}
        />
      </td>
      <td className="py-1.5 pr-4">
        <NumberField
          className="h-8 text-right"
          min={0}
          step="0.01"
          value={purchase.amount}
          onChange={(n) => onPatch({ amount: n })}
        />
      </td>
      <td className="py-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (confirm(`Delete "${purchase.name}"?`)) onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
