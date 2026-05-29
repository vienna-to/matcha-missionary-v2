"use client";

import { useState } from "react";
import { Plus, Minus, Trash2, Sliders, X } from "lucide-react";
import {
  Badge,
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
  COMP_REASONS,
  COMP_REASON_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type CompReason,
  type Ingredient,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type OrderItem,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type SugarAdjustment,
  type IceAdjustment,
} from "@/lib/types";
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
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.paymentStatus);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(
    order.paymentMethod ?? "",
  );
  const [compReason, setCompReason] = useState<CompReason | "">(order.compReason ?? "");
  const [compReasonOther, setCompReasonOther] = useState(order.compReasonOther ?? "");
  const [status, setStatus] = useState<OrderStatus>(order.status);
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
    })),
  );
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);

  const total = items.reduce((sum, it) => {
    const mi = snapshot.menuItems.find((m) => m.id === it.menuItemId);
    return sum + (mi?.price ?? 0) * it.quantity;
  }, 0);

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
  const methodOk = paymentStatus !== "paid" || paymentMethod !== "";
  const compOk = paymentStatus !== "comped" || compReason !== "";
  const itemsOk = items.length > 0;
  const submittable = nameOk && methodOk && compOk && itemsOk;

  function save() {
    if (!submittable) return;
    dispatch({
      type: "UPDATE_ORDER",
      id: order.id,
      patch: {
        customerName: name.trim(),
        paymentStatus,
        paymentMethod: paymentStatus === "paid" ? (paymentMethod as PaymentMethod) : undefined,
        compReason: paymentStatus === "comped" ? (compReason as CompReason) : undefined,
        compReasonOther:
          paymentStatus === "comped" && compReason === "other" && compReasonOther.trim()
            ? compReasonOther.trim()
            : undefined,
        status,
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name" className="col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(!nameOk && "border-amber-400")}
            />
          </Field>
          <Field label="Order status" className="col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {(["pending", "in_progress", "completed", "cancelled"] as OrderStatus[]).map((s) => (
                <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                  {s === "in_progress" ? "In progress" : s[0].toUpperCase() + s.slice(1)}
                </Chip>
              ))}
            </div>
          </Field>
        </div>

        <div>
          <Label>Payment</Label>
          <div className="mt-1.5 flex items-center gap-3">
            <label className="t-caption flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={paymentStatus === "paid"}
                onChange={(e) => setPaymentStatus(e.target.checked ? "paid" : "unpaid")}
                className="h-4 w-4 accent-matcha-500"
              />
              paid
            </label>
            <Chip
              active={paymentStatus === "comped"}
              onClick={() =>
                setPaymentStatus(paymentStatus === "comped" ? "unpaid" : "comped")
              }
            >
              free
            </Chip>
          </div>
        </div>

        {paymentStatus === "paid" ? (
          <Field label="Payment method">
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_METHODS.map((m) => (
                <Chip key={m} active={paymentMethod === m} onClick={() => setPaymentMethod(m)}>
                  {PAYMENT_METHOD_LABELS[m]}
                </Chip>
              ))}
            </div>
          </Field>
        ) : null}

        {paymentStatus === "comped" ? (
          <Field label="free reason">
            <div className="flex flex-wrap gap-1.5">
              {COMP_REASONS.map((r) => (
                <Chip key={r} active={compReason === r} onClick={() => setCompReason(r)}>
                  {COMP_REASON_LABELS[r]}
                </Chip>
              ))}
            </div>
            {compReason === "other" ? (
              <Input
                placeholder="Why? (one line)"
                value={compReasonOther}
                onChange={(e) => setCompReasonOther(e.target.value)}
                className="mt-2"
              />
            ) : null}
          </Field>
        ) : null}

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
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl bg-matcha-50 p-3">
          <span className="text-xs uppercase tracking-wide text-matcha-700">Total</span>
          <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!submittable}>
            Save
          </Button>
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
}: {
  item: DraftItem;
  snapshot: MenuSnapshot;
  onEdit: () => void;
  onRemove: () => void;
  onIncrement: (d: number) => void;
}) {
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

  return (
    <div className="flex items-center gap-2 rounded-xl border border-cream-200 bg-cream-50/50 p-2.5">
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="text-sm font-medium">{displayName}</div>
        {summary.length > 0 ? (
          <div className="mt-0.5 text-xs text-matcha-900/60">{summary.join(" · ")}</div>
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
      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Sliders className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
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
