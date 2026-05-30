"use client";

import { useState } from "react";
import { Plus, Minus, Trash2, Sliders, X } from "lucide-react";
import {
  Button,
  Chip,
  Field,
  Input,
  Label,
  Modal,
  Textarea,
} from "@/components/ui";
import { useDispatch } from "@/lib/store";
import {
  COMBO_PRICE,
  type Ingredient,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type OrderItem,
  type SugarAdjustment,
  type IceAdjustment,
} from "@/lib/types";
import { DiscountRow } from "@/components/DiscountRow";
import { newId } from "@/lib/id";
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
  status: "pending" | "in_progress" | "done";
  // Combo passthrough — preserve when re-saving so existing combos aren't
  // accidentally broken into singletons by an unrelated edit.
  isCombo?: boolean;
  comboPastryId?: string;
};

export default function EditOrderModal({
  order,
  snapshot,
  onClose,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  onClose: () => void;
}) {
  const dispatch = useDispatch();
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
    })),
  );
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);

  // Live total — accounts for combos (fixed bundle price) and per-item
  // discount. Recomputes on every keystroke in the DiscountRow / qty stepper.
  const { total, totalGross } = items.reduce(
    (acc, it) => {
      const unit = it.isCombo
        ? COMBO_PRICE
        : snapshot.menuItems.find((m) => m.id === it.menuItemId)?.price ?? 0;
      const factor = 1 - Math.min(1, Math.max(0, (it.discountPct ?? 0) / 100));
      acc.total += unit * factor * it.quantity;
      acc.totalGross += unit * it.quantity;
      return acc;
    },
    { total: 0, totalGross: 0 },
  );
  const totalDiscount = totalGross - total;

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

  function save() {
    if (!submittable) return;
    dispatch({
      type: "UPDATE_ORDER",
      id: order.id,
      patch: {
        customerName: name.trim(),
        notes: notes.trim() || undefined,
      },
    });
    dispatch({
      type: "REPLACE_ORDER_ITEMS",
      orderId: order.id,
      items: items.map((it) => ({
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
                  onEdit={() => setEditingItemId(it.id)}
                  onRemove={() => removeItem(it.id)}
                  onIncrement={(d) => updateItem(it.id, { quantity: Math.max(1, it.quantity + d) })}
                  onSetDiscount={(pct) =>
                    updateItem(it.id, { discountPct: pct > 0 ? pct : undefined })
                  }
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
          {totalDiscount > 0 ? (
            <div className="t-caption mt-1 flex items-center justify-between text-[11px] text-matcha-700">
              <span>discount applied</span>
              <span className="tabular-nums">−{formatMoney(totalDiscount)}</span>
            </div>
          ) : null}
        </div>

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
  onEdit,
  onRemove,
  onIncrement,
  onSetDiscount,
}: {
  item: DraftItem;
  snapshot: MenuSnapshot;
  onEdit: () => void;
  onRemove: () => void;
  onIncrement: (d: number) => void;
  onSetDiscount: (pct: number) => void;
}) {
  // Hook must run before any conditional return.
  const [discountOpen, setDiscountOpen] = useState(false);
  const mi = snapshot.menuItems.find((m) => m.id === item.menuItemId);
  if (!mi) return null;
  const summary: string[] = [];
  const milk = item.milkChoiceId ?? mi.defaultMilkId;
  if (milk) {
    const ing = snapshot.ingredients.find((i) => i.id === milk);
    if (ing) summary.push(ing.name);
  }
  if (item.creamChoiceId === "none") summary.push("no cream");
  else {
    const cream = item.creamChoiceId ?? mi.defaultCreamId;
    if (cream) {
      const ing = snapshot.ingredients.find((i) => i.id === cream);
      if (ing) summary.push(ing.name);
    }
  }
  if (item.sugarAdjustment && item.sugarAdjustment !== "normal") summary.push(item.sugarAdjustment);
  if (item.iceAdjustment && item.iceAdjustment !== "normal") summary.push(`${item.iceAdjustment} ice`);
  if (item.specialRequests) summary.push(`"${item.specialRequests}"`);

  const pastry = item.isCombo && item.comboPastryId
    ? snapshot.menuItems.find((m) => m.id === item.comboPastryId)
    : undefined;
  const displayName = item.isCombo
    ? `Combo: ${mi.name} + ${pastry?.name ?? "?"}`
    : mi.name;
  const unitPrice = item.isCombo ? COMBO_PRICE : mi.price;
  const pct = item.discountPct ?? 0;

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="text-sm font-medium">{displayName}</div>
          {summary.length > 0 ? (
            <div className="mt-0.5 text-xs text-matcha-900/60">{summary.join(" · ")}</div>
          ) : null}
          {pct > 0 ? (
            <div className="t-caption mt-0.5 text-[11px] text-matcha-700">
              {pct === 100 ? "FREE" : `${pct}% off`}
            </div>
          ) : null}
        </button>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onIncrement(-1)}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <div className="min-w-7 text-center text-sm font-medium tabular-nums">{item.quantity}</div>
          <Button size="sm" variant="outline" onClick={() => onIncrement(1)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button
          size="sm"
          variant={pct > 0 ? "primary" : "ghost"}
          onClick={() => setDiscountOpen((s) => !s)}
          title={pct > 0 ? "Edit discount" : "Add discount"}
        >
          <span className="t-display text-[11px]">%</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Sliders className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {discountOpen ? (
        <DiscountRow
          unitPrice={unitPrice}
          pct={pct}
          onPct={onSetDiscount}
          onClose={() => setDiscountOpen(false)}
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
        {milks.length > 0 ? (
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

        {creams.length > 0 ? (
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
          {showCustomize ? "Hide customize" : "Customize"} · sugar, ice, special requests
        </button>

        {showCustomize ? (
          <div className="space-y-3 rounded-xl border border-cream-200 p-3">
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
