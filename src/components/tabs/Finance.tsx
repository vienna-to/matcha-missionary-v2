"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
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

  // Expenses section state — local-only form fields for the new-purchase row.
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState(0);
  const [newDate, setNewDate] = useState(todayLocal());

  const { currentPurchases, archivedPurchases } = useMemo(() => {
    const current: InventoryPurchase[] = [];
    const archived: InventoryPurchase[] = [];
    for (const p of state.inventoryPurchases) {
      (p.archived ? archived : current).push(p);
    }
    const byDate = (a: InventoryPurchase, b: InventoryPurchase) =>
      b.date.localeCompare(a.date);
    current.sort(byDate);
    archived.sort(byDate);
    return { currentPurchases: current, archivedPurchases: archived };
  }, [state.inventoryPurchases]);

  const currentTotal = currentPurchases.reduce((s, p) => s + p.amount, 0);
  const archivedTotal = archivedPurchases.reduce((s, p) => s + p.amount, 0);

  function addPurchase() {
    if (!newName.trim() || newAmount <= 0 || newDate.length !== 10) return;
    dispatch({
      type: "ADD_INVENTORY_PURCHASE",
      purchase: { name: newName.trim(), amount: newAmount, date: newDate, archived: false },
    });
    setNewName("");
    setNewAmount(0);
    setNewDate(todayLocal());
  }

  function archiveAllCurrent() {
    if (currentPurchases.length === 0) return;
    if (
      !confirm(
        `Archive all ${currentPurchases.length} current expense${
          currentPurchases.length === 1 ? "" : "s"
        }? They'll stay visible below for reference but will stop counting toward net profit going forward.`,
      )
    ) {
      return;
    }
    for (const p of currentPurchases) {
      dispatch({
        type: "UPDATE_INVENTORY_PURCHASE",
        id: p.id,
        patch: { archived: true },
      });
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="t-display text-xl">Finance</h1>
        <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
          derived per-item economics. edit ingredients and items in menu manager.
        </p>
      </header>

      <CurrentExpensesCard
        newName={newName}
        setNewName={setNewName}
        newAmount={newAmount}
        setNewAmount={setNewAmount}
        newDate={newDate}
        setNewDate={setNewDate}
        addPurchase={addPurchase}
        purchases={currentPurchases}
        total={currentTotal}
        dispatch={dispatch}
        onArchiveAll={archiveAllCurrent}
      />

      <ArchivedExpensesCard
        purchases={archivedPurchases}
        total={archivedTotal}
        dispatch={dispatch}
      />

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

function CurrentExpensesCard({
  newName,
  setNewName,
  newAmount,
  setNewAmount,
  newDate,
  setNewDate,
  addPurchase,
  purchases,
  total,
  dispatch,
  onArchiveAll,
}: {
  newName: string;
  setNewName: (s: string) => void;
  newAmount: number;
  setNewAmount: (n: number) => void;
  newDate: string;
  setNewDate: (s: string) => void;
  addPurchase: () => void;
  purchases: InventoryPurchase[];
  total: number;
  dispatch: ReturnType<typeof useStore>["dispatch"];
  onArchiveAll: () => void;
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="t-display text-sm">Expenses</h2>
          <p className="t-caption mt-0.5 text-[11px] text-matcha-900/60">
            one-off purchases (bulk matcha, cups, signage). subtracted from event profit
            in the All Events summary view.
          </p>
        </div>
        <div className="flex items-end gap-3">
          {purchases.length > 0 ? (
            <Button variant="outline" size="sm" onClick={onArchiveAll}>
              <Archive className="h-3.5 w-3.5" /> Archive all
            </Button>
          ) : null}
          <div className="text-right">
            <div className="t-display text-[10px] text-matcha-900/50">Total spent</div>
            <div className="text-base font-semibold tabular-nums">{formatMoney(total)}</div>
          </div>
        </div>
      </div>

      {/* Add-purchase form. Stacks on mobile; columns on sm+. */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
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
            className="w-full sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {purchases.length === 0 ? (
        <p className="t-caption text-xs text-matcha-900/60">
          no current expenses logged yet.
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
              {purchases.map((p) => (
                <PurchaseRow
                  key={p.id}
                  purchase={p}
                  onPatch={(patch) =>
                    dispatch({ type: "UPDATE_INVENTORY_PURCHASE", id: p.id, patch })
                  }
                  onArchiveToggle={() =>
                    dispatch({
                      type: "UPDATE_INVENTORY_PURCHASE",
                      id: p.id,
                      patch: { archived: true },
                    })
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
                  {formatMoney(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function ArchivedExpensesCard({
  purchases,
  total,
  dispatch,
}: {
  purchases: InventoryPurchase[];
  total: number;
  dispatch: ReturnType<typeof useStore>["dispatch"];
}) {
  const [open, setOpen] = useState(false);
  if (purchases.length === 0) return null;
  return (
    <Card>
      <button
        onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <h2 className="t-display text-sm">Archived expenses</h2>
          <p className="t-caption mt-0.5 text-[11px] text-matcha-900/60">
            kept for reference. does not count toward net profit going forward.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="t-display text-[10px] text-matcha-900/50">
              {purchases.length} item{purchases.length === 1 ? "" : "s"}
            </div>
            <div className="text-sm font-semibold tabular-nums text-matcha-900/70">
              {formatMoney(total)}
            </div>
          </div>
          <span className="t-display text-xs text-matcha-700">
            {open ? "hide" : "show"}
          </span>
        </div>
      </button>

      {open ? (
        <div className="mt-3 overflow-x-auto">
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
              {purchases.map((p) => (
                <PurchaseRow
                  key={p.id}
                  purchase={p}
                  archived
                  onPatch={(patch) =>
                    dispatch({ type: "UPDATE_INVENTORY_PURCHASE", id: p.id, patch })
                  }
                  onArchiveToggle={() =>
                    dispatch({
                      type: "UPDATE_INVENTORY_PURCHASE",
                      id: p.id,
                      patch: { archived: false },
                    })
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
                  {formatMoney(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function PurchaseRow({
  purchase,
  archived = false,
  onPatch,
  onArchiveToggle,
  onDelete,
}: {
  purchase: InventoryPurchase;
  archived?: boolean;
  onPatch: (patch: Partial<InventoryPurchase>) => void;
  onArchiveToggle: () => void;
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
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onArchiveToggle}
            aria-label={archived ? "Unarchive" : "Archive"}
            title={archived ? "Unarchive" : "Archive"}
          >
            {archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete "${purchase.name}"?`)) onDelete();
            }}
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
