"use client";

import { AlertTriangle } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { useStore } from "@/lib/store";
import { defaultItemCost, defaultItemMargin, ingredientCostPerCanonical } from "@/lib/calc";
import { compareMenuItems, type Ingredient } from "@/lib/types";
import { UNIT_LABELS, UNIT_TABLE } from "@/lib/units";
import { formatMoney, formatPct } from "@/lib/utils";

export default function Finance() {
  const { state } = useStore();
  const threshold = state.settings.lowMarginThresholdPct / 100;
  const activeItems = state.menuItems.filter((m) => m.active).sort(compareMenuItems);

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
    </div>
  );
}
