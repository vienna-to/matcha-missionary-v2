"use client";

import { useMemo, useState } from "react";
import { Plus, Minus, Trash2, Sliders, X } from "lucide-react";
import {
  Button,
  Chip,
  Field,
  Input,
  Label,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { useDispatch, useStore } from "@/lib/store";
import {
  COMBO_PRICE,
  type FreeReason,
  type Ingredient,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type OrderItem,
  type PaymentMethod,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type SugarAdjustment,
  type IceAdjustment,
} from "@/lib/types";
import { DiscountRow } from "@/components/DiscountRow";
import ExtraPicker from "@/components/ExtraPicker";
import { amountOwed, extraAmount, isFreeTotal, NO_EXTRA, type ExtraDraft } from "@/lib/order-steps";
import { chargedUnitFromPct } from "@/lib/pricing";
import { useHelperMode } from "@/lib/helper-mode";
import { newId } from "@/lib/id";
import { hasDrinkAdjustments } from "@/lib/order-labels";
import { cn, formatMoney } from "@/lib/utils";

type DraftItem = {
  id: string; // matches OrderItem.id for existing, new ones get tempIds
  menuItemId: string;
  quantity: number;
  milkChoiceId?: string;
  creamChoiceId?: string;
  sugarAdjustment?: SugarAdjustment;
  iceAdjustment?: IceAdjustment;
  specialRequests?: string;
  discountPct?: number;
  freeReason?: FreeReason;
  status: "pending" | "in_progress" | "done";
  // Combo passthrough — preserve when re-saving so existing combos aren't
  // accidentally broken into singletons by an unrelated edit.
  isCombo?: boolean;
  comboPastryId?: string;
};

export default function EditOrderModal({
  order,
  snapshot: eventSnapshot,
  onClose,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  onClose: () => void;
}) {
  const dispatch = useDispatch();
  const { state } = useStore();
  // Live Orders sells from the master menu, so a line can reference an item added
  // after the event snapshot was taken. Fall back to the master menu for those
  // (same rule as the reducer) so the line is shown and priced, not dropped.
  const snapshot = useMemo<MenuSnapshot>(
    () => ({
      ...eventSnapshot,
      menuItems: [
        ...eventSnapshot.menuItems,
        ...state.menuItems.filter((m) => !eventSnapshot.menuItems.some((s) => s.id === m.id)),
      ],
      ingredients: [
        ...eventSnapshot.ingredients,
        ...state.ingredients.filter((i) => !eventSnapshot.ingredients.some((s) => s.id === i.id)),
      ],
    }),
    [eventSnapshot, state.menuItems, state.ingredients],
  );
  const [helperMode] = useHelperMode();
  const [name, setName] = useState(order.customerName);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(() =>
    order.items.map((it) => ({
      id: it.id,
      menuItemId: it.menuItemId,
      quantity: it.quantity,
      milkChoiceId: it.milkChoiceId,
      creamChoiceId: it.creamChoiceId,
      sugarAdjustment: it.sugarAdjustment,
      iceAdjustment: it.iceAdjustment,
      specialRequests: it.specialRequests,
      status: it.status,
      isCombo: it.isCombo,
      comboPastryId: it.comboPastryId,
      discountPct: it.discountPct,
      freeReason: it.freeReason,
    })),
  );
  const [extra, setExtra] = useState<ExtraDraft>(() =>
    order.tipAmount && order.tipAmount > 0
      ? { mode: "custom", custom: order.tipAmount, method: order.tipPaymentMethod ?? "" }
      : NO_EXTRA,
  );
  // Orders from before free orders existed may have no method. It is only
  // asked for here when money is actually due.
  const [orderMethod, setOrderMethod] = useState<PaymentMethod | "">(order.paymentMethod ?? "");
  const [error, setError] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);

  // Live total — accounts for combos (fixed bundle price) and per-item
  // discount. Recomputes on every keystroke in the DiscountRow / qty stepper.
  const { total, totalGross } = items.reduce(
    (acc, it) => {
      // An existing line keeps the price it was sold at; only new lines use the menu.
      const unit = it.isCombo
        ? COMBO_PRICE
        : order.items.find((o) => o.id === it.id)?.priceSnap ??
          snapshot.menuItems.find((m) => m.id === it.menuItemId)?.price ??
          0;
      acc.total += chargedUnitFromPct(unit, it.discountPct) * it.quantity;
      acc.totalGross += unit * it.quantity;
      return acc;
    },
    { total: 0, totalGross: 0 },
  );
  const totalDiscount = totalGross - total;
  const extraDollars = extraAmount(extra, amountOwed(total));

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function removeItem(id: string) {
    setItems((arr) => arr.filter((it) => it.id !== id));
  }
  function addItem(menuItem: MenuItem) {
    setItems((arr) => [
      ...arr,
      {
        id: newId("tmp"),
        menuItemId: menuItem.id,
        quantity: 1,
        status: "pending",
      },
    ]);
    setShowAddPicker(false);
  }

  const nameOk = name.trim().length > 0;
  const itemsOk = items.length > 0;
  const submittable = nameOk && itemsOk;

  function deleteOrder() {
    if (!confirm(`Delete order #${order.orderNumber} for ${order.customerName}?`)) return;
    dispatch({ type: "DELETE_ORDER", id: order.id });
    onClose();
  }

  const free = items.length > 0 && isFreeTotal(total);

  function save() {
    if (!submittable) return;
    if (!free && orderMethod === "") {
      setError("Pick a payment method to save.");
      return;
    }
    if (extraDollars > 0 && !extra.method && orderMethod === "") {
      setError("Pick how the tip was paid.");
      return;
    }
    setError(null);
    // Only touch the tip columns when the tip actually changed, so a plain
    // name edit never depends on them.
    const newMethod =
      extraDollars > 0 && extra.method && extra.method !== orderMethod
        ? extra.method
        : undefined;
    const tipChanged =
      extraDollars !== (order.tipAmount ?? 0) || newMethod !== order.tipPaymentMethod;
    dispatch({
      type: "UPDATE_ORDER",
      id: order.id,
      patch: {
        customerName: name.trim(),
        notes: notes.trim() || undefined,
        // Only written when it changed. A free order keeps whatever real
        // method it had; it is never given a made-up one.
        ...(orderMethod !== (order.paymentMethod ?? "")
          ? { paymentMethod: orderMethod || undefined }
          : {}),
        ...(free && order.paymentStatus !== "comped" ? { paymentStatus: "comped" as const } : {}),
        ...(!free && order.paymentStatus === "comped" ? { paymentStatus: "paid" as const } : {}),
        ...(tipChanged
          ? { tipAmount: extraDollars > 0 ? extraDollars : undefined, tipPaymentMethod: newMethod }
          : {}),
      },
    });
    dispatch({
      type: "REPLACE_ORDER_ITEMS",
      orderId: order.id,
      items: items.map((it) => ({
        // Existing lines keep their sale-time price and cost; new ones are tmp ids.
        sourceItemId: order.items.some((o) => o.id === it.id) ? it.id : undefined,
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        milkChoiceId: it.milkChoiceId,
        creamChoiceId: it.creamChoiceId,
        sugarAdjustment: it.sugarAdjustment,
        iceAdjustment: it.iceAdjustment,
        specialRequests: it.specialRequests,
        status: it.status,
        isCombo: it.isCombo,
        comboPastryId: it.comboPastryId,
        discountPct: it.discountPct,
        freeReason: it.freeReason,
      })),
    });
    onClose();
  }

  const editingItem = editingItemId ? items.find((i) => i.id === editingItemId) : undefined;
  const editingMenuItem = editingItem
    ? snapshot.menuItems.find((m) => m.id === editingItem.menuItemId)
    : undefined;

  return (
    <Modal open onClose={onClose} title={`Edit order #${order.orderNumber}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3">
          <Field label="Customer name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(!nameOk && "border-amber-400")}
            />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="rounded-xl border border-cream-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Items</h4>
            <Button size="sm" variant="outline" onClick={() => setShowAddPicker(true)}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-matcha-900/60">No items.</p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <DraftItemRow
                  key={it.id}
                  item={it}
                  snapshot={snapshot}
                  stampedUnit={order.items.find((o) => o.id === it.id)?.priceSnap}
                  onEdit={() => setEditingItemId(it.id)}
                  onRemove={() => removeItem(it.id)}
                  onIncrement={(d) =>
                    // Minus at quantity 1 removes the line instead of doing nothing.
                    it.quantity + d < 1 ? removeItem(it.id) : updateItem(it.id, { quantity: it.quantity + d })
                  }
                  onSetDiscount={(pct) =>
                    updateItem(it.id, { discountPct: pct > 0 ? pct : undefined })
                  }
                  onSetFreeReason={(r) => updateItem(it.id, { freeReason: r })}
                  helperMode={helperMode}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-matcha-50 p-3">
          <div className="flex items-center justify-between">
            <span className="t-display text-xs text-matcha-700">Total</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
          {/* Discount origin is hidden for helpers — they see the final total
              only, no "-$X discount" breakdown. */}
          {totalDiscount > 0 && !helperMode ? (
            <div className="t-caption mt-1 flex items-center justify-between text-[11px] text-matcha-700">
              <span>discount applied</span>
              <span className="tabular-nums">−{formatMoney(totalDiscount)}</span>
            </div>
          ) : null}
        </div>

        <ExtraPicker
          owed={amountOwed(total)}
          draft={extra}
          onChange={setExtra}
          orderMethod={orderMethod}
        />

        {!order.paymentMethod && !free ? (
          <Field label="Payment method (required)">
            <Select
              value={orderMethod}
              onChange={(e) => {
                setOrderMethod(e.target.value as PaymentMethod | "");
                setError(null);
              }}
              className={cn(error && orderMethod === "" && "border-red-400")}
            >
              <option value="">Choose a method</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-xl border-2 border-red-400 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button variant="danger" onClick={deleteOrder}>
            <Trash2 className="h-3.5 w-3.5" /> Delete order
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!submittable}>
              Save
            </Button>
          </div>
        </div>
      </div>

      {editingItem && editingMenuItem ? (
        <CustomizeItemModal
          item={editingMenuItem}
          ingredients={snapshot.ingredients}
          draft={editingItem}
          onSave={(patch) => {
            updateItem(editingItem.id, patch);
            setEditingItemId(null);
          }}
          onClose={() => setEditingItemId(null)}
        />
      ) : null}

      {showAddPicker ? (
        <AddItemPickerModal
          items={snapshot.menuItems.filter((m) => m.active)}
          onPick={addItem}
          onClose={() => setShowAddPicker(false)}
        />
      ) : null}
    </Modal>
  );
}

function DraftItemRow({
  item,
  snapshot,
  stampedUnit,
  onEdit,
  onRemove,
  onIncrement,
  onSetDiscount,
  onSetFreeReason,
  helperMode,
}: {
  item: DraftItem;
  snapshot: MenuSnapshot;
  /** Price this line was sold at, when it already exists on the order. */
  stampedUnit?: number;
  onEdit: () => void;
  onRemove: () => void;
  onIncrement: (d: number) => void;
  onSetDiscount: (pct: number) => void;
  onSetFreeReason: (reason: FreeReason | undefined) => void;
  helperMode: boolean;
}) {
  // Hook must run before any conditional return.
  const [discountOpen, setDiscountOpen] = useState(false);
  const mi = snapshot.menuItems.find((m) => m.id === item.menuItemId);
  if (!mi) return null;
  const summary: string[] = [];
  const drinkOptions = hasDrinkAdjustments(mi);
  const milk = item.milkChoiceId ?? mi.defaultMilkId;
  if (drinkOptions && milk) {
    const ing = snapshot.ingredients.find((i) => i.id === milk);
    if (ing) summary.push(ing.name);
  }
  if (!drinkOptions) {
    // pastry: no cream / sugar / ice in the summary
  } else if (item.creamChoiceId === "none") summary.push("no cream");
  else {
    const cream = item.creamChoiceId ?? mi.defaultCreamId;
    if (cream) {
      const ing = snapshot.ingredients.find((i) => i.id === cream);
      if (ing) summary.push(ing.name);
    }
  }
  if (drinkOptions && item.sugarAdjustment && item.sugarAdjustment !== "normal") summary.push(item.sugarAdjustment);
  if (drinkOptions && item.iceAdjustment && item.iceAdjustment !== "normal") summary.push(`${item.iceAdjustment} ice`);
  if (item.specialRequests) summary.push(`"${item.specialRequests}"`);

  const pastry = item.isCombo && item.comboPastryId
    ? snapshot.menuItems.find((m) => m.id === item.comboPastryId)
    : undefined;
  const displayName = item.isCombo
    ? `Combo: ${mi.name} + ${pastry?.name ?? "?"}`
    : mi.name;
  const unitPrice = item.isCombo ? COMBO_PRICE : stampedUnit ?? mi.price;
  const pct = item.discountPct ?? 0;

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="text-sm font-medium">{displayName}</div>
          {summary.length > 0 ? (
            <div className="mt-0.5 text-xs text-matcha-900/60">{summary.join(" · ")}</div>
          ) : null}
          {pct > 0 && !helperMode ? (
            <div className="t-caption mt-0.5 text-[11px] text-matcha-700">
              {pct === 100 ? "FREE" : `${pct}% off`}
            </div>
          ) : null}
        </button>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" aria-label="Fewer" onClick={() => onIncrement(-1)}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <div className="min-w-7 text-center text-sm font-medium tabular-nums">{item.quantity}</div>
          <Button size="sm" variant="outline" aria-label="More" onClick={() => onIncrement(1)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {helperMode ? null : (
          <Button
            size="sm"
            variant={pct > 0 ? "primary" : "ghost"}
            onClick={() => setDiscountOpen((s) => !s)}
            title={pct > 0 ? "Edit discount" : "Add discount"}
          >
            <span className="t-display text-[11px]">%</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Sliders className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {discountOpen && !helperMode ? (
        <DiscountRow
          unitPrice={unitPrice}
          pct={pct}
          onPct={onSetDiscount}
          onClose={() => setDiscountOpen(false)}
          freeReason={item.freeReason}
          onFreeReason={onSetFreeReason}
        />
      ) : null}
    </div>
  );
}

function CustomizeItemModal({
  item,
  ingredients,
  draft,
  onSave,
  onClose,
}: {
  item: MenuItem;
  ingredients: Ingredient[];
  draft: DraftItem;
  onSave: (patch: Partial<DraftItem>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<DraftItem>(draft);
  const [showCustomize, setShowCustomize] = useState(false);
  const drinkOptions = hasDrinkAdjustments(item);

  const milks = item.allowedMilkIds
    .map((id) => ingredients.find((i) => i.id === id))
    .filter((i): i is Ingredient => Boolean(i));
  const creams = item.allowedCreamIds
    .map((id) => ingredients.find((i) => i.id === id))
    .filter((i): i is Ingredient => Boolean(i));

  function patch<K extends keyof DraftItem>(k: K, v: DraftItem[K]) {
    setLocal((d) => ({ ...d, [k]: v }));
  }

  const selectedMilkId = local.milkChoiceId ?? item.defaultMilkId;
  const selectedCreamId =
    local.creamChoiceId === undefined ? item.defaultCreamId : local.creamChoiceId;

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {drinkOptions && milks.length > 0 ? (
          <div>
            <Label>Milk</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {milks.map((m) => (
                <Chip
                  key={m.id}
                  active={selectedMilkId === m.id}
                  onClick={() => patch("milkChoiceId", m.id)}
                >
                  {m.name}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {drinkOptions && creams.length > 0 ? (
          <div>
            <Label>Cream</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {creams.map((m) => (
                <Chip
                  key={m.id}
                  active={selectedCreamId === m.id}
                  onClick={() => patch("creamChoiceId", m.id)}
                >
                  {m.name}
                </Chip>
              ))}
              <Chip
                active={selectedCreamId === "none"}
                onClick={() => patch("creamChoiceId", "none")}
              >
                No cream
              </Chip>
            </div>
          </div>
        ) : null}

        <button
          onClick={() => setShowCustomize((s) => !s)}
          className="w-full rounded-xl bg-cream-100 px-3 py-2 text-left text-xs font-medium text-matcha-900/70 hover:bg-cream-200"
        >
          {showCustomize ? "Hide customize" : "Customize"} ·{" "}
          {drinkOptions ? "sugar, ice, special requests" : "special requests"}
        </button>

        {showCustomize ? (
          <div className="space-y-3 rounded-xl border border-cream-200 p-3">
            {drinkOptions ? (
            <>
            <div>
              <Label>Sugar</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["less", "normal", "extra", "no_agave"] as SugarAdjustment[]).map((s) => (
                  <Chip key={s} active={local.sugarAdjustment === s} onClick={() => patch("sugarAdjustment", s)}>
                    {s === "less" ? "Less sweet" : s === "normal" ? "Normal" : s === "extra" ? "Extra sweet" : "No agave"}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Label>Ice</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["light", "normal", "extra"] as IceAdjustment[]).map((s) => (
                  <Chip key={s} active={local.iceAdjustment === s} onClick={() => patch("iceAdjustment", s)}>
                    {s === "light" ? "Light ice" : s === "normal" ? "Normal ice" : "Extra ice"}
                  </Chip>
                ))}
              </div>
            </div>
            </>
            ) : null}
            <Field label="Special requests">
              <Input
                value={local.specialRequests ?? ""}
                onChange={(e) => patch("specialRequests", e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(local)}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function AddItemPickerModal({
  items,
  onPick,
  onClose,
}: {
  items: MenuItem[];
  onPick: (it: MenuItem) => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Add item">
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onPick(it)}
            className="flex flex-col items-start rounded-xl border border-cream-200 bg-white p-3 text-left hover:bg-cream-100"
          >
            <div className="text-sm font-medium">{it.name}</div>
            <div className="mt-1 text-xs text-matcha-900/60">{formatMoney(it.price)}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
