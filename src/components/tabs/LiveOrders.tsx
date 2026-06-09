"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Minus,
  Sliders,
  Trash2,
  Coffee,
  ShoppingBag,
  X,
} from "lucide-react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Label,
  Modal,
  NumberField,
  Select,
  Sheet,
  Textarea,
} from "@/components/ui";
import { useActiveEvent, useStore } from "@/lib/store";
import {
  COMBO_PRICE,
  compareMenuItems,
  type Ingredient,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type SugarAdjustment,
  type IceAdjustment,
} from "@/lib/types";
import { computeItemCost } from "@/lib/calc";
import { deriveOrderItem, nextOrderNumber } from "@/lib/reducer";
import { newId, nowIso } from "@/lib/id";
import { DiscountRow } from "@/components/DiscountRow";
import { cn, formatMoney } from "@/lib/utils";

// Canonical milk options offered in Live Orders. The chips always render with
// these labels. `match` is used to resolve the choice to a real ingredient ID
// in the workspace (so cost calc picks up milk cost); if no ingredient matches,
// we fall back to the synthetic `id` here and display the label via
// `milkLabelForId`.
const MILK_CHOICES: Array<{ id: string; name: string; match: RegExp }> = [
  { id: "__milk_whole", name: "Whole milk", match: /whole/i },
  { id: "__milk_lactose", name: "Lactose free milk", match: /lactose/i },
];

function resolveMilkChoices(ingredients: Ingredient[]) {
  return MILK_CHOICES.map((c) => {
    const ing = ingredients.find(
      (i) => /milk/i.test(i.name) && c.match.test(i.name),
    );
    return { id: ing?.id ?? c.id, name: c.name };
  });
}

function milkLabelForId(id: string): string | undefined {
  return MILK_CHOICES.find((c) => c.id === id)?.name;
}

type CartLine = {
  cid: string;
  menuItemId: string;
  quantity: number;
  milkChoiceId?: string;
  creamChoiceId?: string; // "none" means no cream; undefined means use default
  sugarAdjustment?: SugarAdjustment;
  iceAdjustment?: IceAdjustment;
  specialRequests?: string;
  /** Per-item discount as a percent (0–100). 100 = free. */
  discountPct?: number;
  /** Combo deal: priced at COMBO_PRICE, bundles drink (menuItemId) + pastry. */
  isCombo?: boolean;
  comboPastryId?: string;
};

export default function LiveOrders() {
  const event = useActiveEvent();
  const { state, dispatch } = useStore();

  // Live Orders draws from the *current* master menu (state.menuItems +
  // state.ingredients) — not the per-event frozen snapshot — so MenuManager
  // edits (add/edit/archive/reorder) show up here immediately. The order item
  // captures priceSnap/costSnap/menuItemNameSnap at submission time, which is
  // what preserves historical fidelity, so the picker doesn't need a frozen
  // copy. Past events keep their persisted snapshot untouched.
  const snapshot: MenuSnapshot | undefined = useMemo(() => {
    if (!event) return undefined;
    return {
      id: event.menuSnapshotId,
      menuItems: state.menuItems,
      ingredients: state.ingredients,
      createdAt: event.createdAt,
    };
  }, [event, state.menuItems, state.ingredients]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [editingCid, setEditingCid] = useState<string | null>(null);
  const [cartOpenMobile, setCartOpenMobile] = useState(false);
  const [comboPickerOpen, setComboPickerOpen] = useState(false);

  if (!event || !snapshot) {
    return (
      <EmptyState
        title="No active event"
        description="Create an event in the Event Summary tab to start taking orders."
      />
    );
  }

  const activeEvent_ = event;
  // Capture the narrowed snapshot reference so closures (submit, addLine etc.)
  // don't lose the non-undefined narrowing TS gave us via the early return.
  const snap = snapshot;
  const activeItems = snap.menuItems.filter((m) => m.active).sort(compareMenuItems);
  const total = cart.reduce((sum, line) => {
    const unit = line.isCombo
      ? COMBO_PRICE
      : snapshot.menuItems.find((m) => m.id === line.menuItemId)?.price ?? 0;
    const factor = 1 - Math.min(1, Math.max(0, (line.discountPct ?? 0) / 100));
    return sum + unit * factor * line.quantity;
  }, 0);

  function addLine(item: MenuItem) {
    setCart((c) => [
      ...c,
      {
        cid: newId("cart"),
        menuItemId: item.id,
        quantity: 1,
      },
    ]);
  }

  function addCombo(drinkId: string, pastryId: string) {
    setCart((c) => [
      ...c,
      {
        cid: newId("cart"),
        menuItemId: drinkId,
        quantity: 1,
        isCombo: true,
        comboPastryId: pastryId,
      },
    ]);
    setComboPickerOpen(false);
  }

  function updateLine(cid: string, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.cid === cid ? { ...l, ...patch } : l)));
  }
  function removeLine(cid: string) {
    setCart((c) => c.filter((l) => l.cid !== cid));
  }

  function reset() {
    setCart([]);
    setCustomerName("");
    setNotes("");
    setCartOpenMobile(false);
  }

  const nameOk = customerName.trim().length > 0;
  const submittable = cart.length > 0 && nameOk;

  function submit() {
    if (!submittable) return;
    // Build the full Order in the caller so the dispatch wrapper can write to
    // Supabase without re-reading stateRef (which races on rapid submits).
    const orderId = newId("ord");
    const orderNumber = nextOrderNumber(state, activeEvent_.id);
    const submittedAt = nowIso();
    const items = cart.map((l) =>
      deriveOrderItem(
        {
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          milkChoiceId: l.milkChoiceId,
          creamChoiceId: l.creamChoiceId,
          sugarAdjustment: l.sugarAdjustment,
          iceAdjustment: l.iceAdjustment,
          specialRequests: l.specialRequests,
          discountPct: l.discountPct,
          isCombo: l.isCombo,
          comboPastryId: l.comboPastryId,
          status: "pending",
        },
        orderId,
        snap,
      ),
    );
    const order: Order = {
      id: orderId,
      eventId: activeEvent_.id,
      orderNumber,
      customerName: customerName.trim(),
      items,
      notes: notes.trim() || undefined,
      submittedAt,
      updatedAt: submittedAt,
      // Orders are pending until the barista checks all items off / marks the
      // order complete. Legacy paymentStatus kept so DB column has a value.
      status: "pending",
      paymentStatus: "paid",
    };
    dispatch({ type: "SUBMIT_ORDER", order });
    reset();
  }

  const editingLine = editingCid ? cart.find((l) => l.cid === editingCid) : undefined;
  const editingItem = editingLine
    ? snapshot.menuItems.find((m) => m.id === editingLine.menuItemId)
    : undefined;

  return (
    <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6">
      <div>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="t-display text-xl">Live Orders</h1>
            <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
              tap a card to add. use the slider icon to customize.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setComboPickerOpen(true)}>
            + Combo deal · {formatMoney(COMBO_PRICE)}
          </Button>
        </header>
        <ItemGrid items={activeItems} onAdd={addLine} />
      </div>

      {/* Cart — sidebar on desktop */}
      <aside className="hidden lg:block">
        <div className="sticky top-4">
          <CartPanel
            cart={cart}
            snapshot={snapshot}
            onEdit={(cid) => setEditingCid(cid)}
            onRemove={removeLine}
            onIncrement={(cid, delta) => {
              const line = cart.find((l) => l.cid === cid);
              if (!line) return;
              const q = Math.max(1, line.quantity + delta);
              updateLine(cid, { quantity: q });
            }}
            onDiscount={(cid, pct) => updateLine(cid, { discountPct: pct })}
            customerName={customerName}
            setCustomerName={setCustomerName}
            notes={notes}
            setNotes={setNotes}
            total={total}
            submittable={submittable}
            onSubmit={submit}
            errors={{ name: !nameOk }}
          />
        </div>
      </aside>

      {/* Cart button & sheet (mobile) */}
      <div className="lg:hidden">
        {cart.length > 0 ? (
          <button
            onClick={() => setCartOpenMobile(true)}
            className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-matcha-500 px-4 py-3 text-sm font-medium text-white shadow-lg"
          >
            <ShoppingBag className="h-4 w-4" />
            {cart.reduce((s, l) => s + l.quantity, 0)} · {formatMoney(total)}
          </button>
        ) : null}
        <Sheet open={cartOpenMobile} onClose={() => setCartOpenMobile(false)} side="bottom">
          <div className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Order</h3>
              <button onClick={() => setCartOpenMobile(false)} className="p-1.5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <CartPanel
              cart={cart}
              snapshot={snapshot}
              onEdit={(cid) => {
                setCartOpenMobile(false);
                setEditingCid(cid);
              }}
              onRemove={removeLine}
              onIncrement={(cid, delta) => {
                const line = cart.find((l) => l.cid === cid);
                if (!line) return;
                const q = Math.max(1, line.quantity + delta);
                updateLine(cid, { quantity: q });
              }}
              onDiscount={(cid, pct) => updateLine(cid, { discountPct: pct })}
              customerName={customerName}
              setCustomerName={setCustomerName}
              notes={notes}
              setNotes={setNotes}
              total={total}
              submittable={submittable}
              onSubmit={() => submit()}
              errors={{ name: !nameOk }}
            />
          </div>
        </Sheet>
      </div>

      {editingLine && editingItem ? (
        <CustomizeModal
          line={editingLine}
          item={editingItem}
          ingredients={snapshot.ingredients}
          onClose={() => setEditingCid(null)}
          onSave={(patch) => {
            updateLine(editingLine.cid, patch);
            setEditingCid(null);
          }}
        />
      ) : null}

      {comboPickerOpen ? (
        <ComboPickerModal
          items={activeItems}
          onClose={() => setComboPickerOpen(false)}
          onPick={addCombo}
        />
      ) : null}
    </div>
  );
}

function ComboPickerModal({
  items,
  onClose,
  onPick,
}: {
  items: MenuItem[];
  onClose: () => void;
  onPick: (drinkId: string, pastryId: string) => void;
}) {
  // Any active item can be either side of the combo — let the user decide
  // since "pastry" isn't strictly modelled anymore. We do put items tagged
  // category="pastry" at the top of the pastry picker for convenience.
  const pastryFirst = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const ap = a.category === "pastry" ? 0 : 1;
      const bp = b.category === "pastry" ? 0 : 1;
      return ap - bp || compareMenuItems(a, b);
    });
    return arr;
  }, [items]);

  const initialDrink = items.find((m) => m.category !== "pastry")?.id ?? items[0]?.id ?? "";
  const initialPastry = pastryFirst[0]?.id ?? "";

  const [drinkId, setDrinkId] = useState<string>(initialDrink);
  const [pastryId, setPastryId] = useState<string>(initialPastry);

  const drink = items.find((m) => m.id === drinkId);
  const pastry = items.find((m) => m.id === pastryId);
  const savings = (drink?.price ?? 0) + (pastry?.price ?? 0) - COMBO_PRICE;
  const valid = Boolean(drink && pastry && drinkId !== pastryId);

  return (
    <Modal open onClose={onClose} title={`Combo deal — ${formatMoney(COMBO_PRICE)}`}>
      <div className="space-y-3">
        <p className="t-caption text-xs text-matcha-900/60">
          pick any drink and any pastry — bundle is fixed at {formatMoney(COMBO_PRICE)}.
          customize the drink&apos;s milk / cream after adding via the cart.
        </p>
        <Field label="drink">
          <Select value={drinkId} onChange={(e) => setDrinkId(e.target.value)}>
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.name} · ${formatMoney(m.price)}`.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="pastry">
          <Select value={pastryId} onChange={(e) => setPastryId(e.target.value)}>
            {pastryFirst.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.name} · ${formatMoney(m.price)}`.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <div className="t-caption flex items-center justify-between rounded-xl bg-matcha-50 px-3 py-2 text-xs text-matcha-900/80">
          <span>combo price</span>
          <span className="tabular-nums">
            {formatMoney(COMBO_PRICE)}
            {savings > 0 ? (
              <span className="ml-2 text-matcha-700">(save {formatMoney(savings)})</span>
            ) : null}
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onPick(drinkId, pastryId)} disabled={!valid}>
            Add combo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ItemGrid({
  items,
  onAdd,
}: {
  items: MenuItem[];
  onAdd: (item: MenuItem) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No active menu items"
        description="Add (or unarchive) a menu item in Menu Manager — it'll show up here immediately."
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onAdd(item)}
          className="group relative flex h-44 flex-col rounded-2xl border border-cream-200 bg-white p-4 text-left transition-all hover:border-matcha-300 hover:shadow-md active:scale-[0.98]"
        >
          <div className="min-w-0">
            <div className="t-display text-sm leading-tight">{item.name}</div>
            {item.description ? (
              <div className="t-caption mt-2 line-clamp-3 text-xs text-matcha-900/60">
                {item.description}
              </div>
            ) : null}
          </div>
          <div className="mt-auto flex items-end justify-between">
            <div className="text-base font-semibold tabular-nums">
              {formatMoney(item.price)}
            </div>
            <span className="rounded-full bg-matcha-500 p-1.5 text-white opacity-90 group-hover:opacity-100">
              <Plus className="h-3.5 w-3.5" />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function CartPanel({
  cart,
  snapshot,
  onEdit,
  onRemove,
  onIncrement,
  onDiscount,
  customerName,
  setCustomerName,
  notes,
  setNotes,
  total,
  submittable,
  onSubmit,
  errors,
}: {
  cart: CartLine[];
  snapshot: MenuSnapshot;
  onEdit: (cid: string) => void;
  onRemove: (cid: string) => void;
  onIncrement: (cid: string, delta: number) => void;
  onDiscount: (cid: string, pct: number | undefined) => void;
  customerName: string;
  setCustomerName: (s: string) => void;
  notes: string;
  setNotes: (s: string) => void;
  total: number;
  submittable: boolean;
  onSubmit: () => void;
  errors: { name: boolean };
}) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="t-display text-sm">Cart</h3>
        <p className="t-caption text-xs text-matcha-900/60">
          {cart.length === 0
            ? "tap an item to add"
            : `${cart.length} line${cart.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {cart.length > 0 ? (
        <div className="space-y-2">
          {cart.map((line) => (
            <CartLineRow
              key={line.cid}
              line={line}
              snapshot={snapshot}
              onEdit={() => onEdit(line.cid)}
              onRemove={() => onRemove(line.cid)}
              onIncrement={(delta) => onIncrement(line.cid, delta)}
              onDiscount={(pct) => onDiscount(line.cid, pct)}
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-3 border-t border-cream-200 pt-3">
        <Field label="customer name">
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="required"
            className={cn(errors.name && "border-amber-400")}
          />
        </Field>
        <Field label="order notes (optional)">
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>

      <div className="rounded-xl bg-matcha-50 p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="t-display text-[11px] text-matcha-700">Total</div>
            <div className="text-2xl font-semibold tabular-nums text-matcha-900">
              {formatMoney(total)}
            </div>
          </div>
          <Button size="lg" onClick={onSubmit} disabled={!submittable}>
            Submit
          </Button>
        </div>
        {!submittable && cart.length > 0 && errors.name ? (
          <div className="t-caption mt-2 text-[11px] text-amber-700">
            name required.
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function CartLineRow({
  line,
  snapshot,
  onEdit,
  onRemove,
  onIncrement,
  onDiscount,
}: {
  line: CartLine;
  snapshot: MenuSnapshot;
  onEdit: () => void;
  onRemove: () => void;
  onIncrement: (delta: number) => void;
  onDiscount: (pct: number | undefined) => void;
}) {
  // All hooks must run before any conditional early return.
  const [discountOpen, setDiscountOpen] = useState(false);
  const item = snapshot.menuItems.find((m) => m.id === line.menuItemId);
  if (!item) return null;
  const milk = line.milkChoiceId
    ? snapshot.ingredients.find((i) => i.id === line.milkChoiceId)?.name
        ?? milkLabelForId(line.milkChoiceId)
    : item.defaultMilkId
    ? snapshot.ingredients.find((i) => i.id === item.defaultMilkId)?.name
    : undefined;
  let cream: string | undefined;
  if (line.creamChoiceId === "none") cream = "no cream";
  else if (line.creamChoiceId) {
    cream = snapshot.ingredients.find((i) => i.id === line.creamChoiceId)?.name;
  } else if (item.defaultCreamId) {
    cream = snapshot.ingredients.find((i) => i.id === item.defaultCreamId)?.name;
  }

  const mods: string[] = [];
  if (milk) mods.push(milk);
  if (cream) mods.push(cream);
  if (line.sugarAdjustment && line.sugarAdjustment !== "normal") {
    mods.push(
      line.sugarAdjustment === "less"
        ? "less sweet"
        : line.sugarAdjustment === "extra"
        ? "extra sweet"
        : "no agave",
    );
  }
  if (line.iceAdjustment && line.iceAdjustment !== "normal") {
    mods.push(line.iceAdjustment === "light" ? "light ice" : "extra ice");
  }
  if (line.specialRequests) mods.push(`"${line.specialRequests}"`);

  const pastry = line.isCombo && line.comboPastryId
    ? snapshot.menuItems.find((m) => m.id === line.comboPastryId)
    : undefined;
  const lineUnitPrice = line.isCombo ? COMBO_PRICE : item.price;
  const discountFraction = Math.min(1, Math.max(0, (line.discountPct ?? 0) / 100));
  const effectiveUnit = lineUnitPrice * (1 - discountFraction);
  const displayName = line.isCombo
    ? `Combo: ${item.name} + ${pastry?.name ?? "?"}`
    : item.name;

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50/50 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="t-display text-sm">{displayName}</div>
          {mods.length > 0 ? (
            <div className="t-caption mt-0.5 line-clamp-2 text-xs text-matcha-900/60">
              {mods.join(" · ")}
            </div>
          ) : (
            <div className="t-caption mt-0.5 text-xs text-matcha-900/40">
              tap to customize
            </div>
          )}
        </button>
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">
            {formatMoney(effectiveUnit * line.quantity)}
          </div>
          {discountFraction > 0 ? (
            <div className="t-caption text-[11px] text-matcha-700">
              {line.discountPct === 100 ? "FREE" : `${line.discountPct}% off`}
            </div>
          ) : null}
        </div>
      </div>
      {discountOpen ? (
        <DiscountRow
          unitPrice={lineUnitPrice}
          pct={line.discountPct ?? 0}
          onPct={(p) => onDiscount(p > 0 ? Math.min(100, Math.max(0, p)) : undefined)}
          onClose={() => setDiscountOpen(false)}
        />
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onIncrement(-1)}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <div className="min-w-8 text-center text-sm font-medium tabular-nums">
            {line.quantity}
          </div>
          <Button size="sm" variant="outline" onClick={() => onIncrement(1)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDiscountOpen((s) => !s)}
            title="Discount"
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
      </div>
    </div>
  );
}

function CustomizeModal({
  line,
  item,
  ingredients,
  onClose,
  onSave,
}: {
  line: CartLine;
  item: MenuItem;
  ingredients: Ingredient[];
  onClose: () => void;
  onSave: (patch: Partial<CartLine>) => void;
}) {
  const [draft, setDraft] = useState<CartLine>(line);
  const [showCustomize, setShowCustomize] = useState(false);

  // Milk picker is hardcoded to Whole / Lactose-free. We resolve to real
  // ingredient IDs by name (regardless of `pool` flag, which isn't reliable
  // on legacy/user-added ingredients) so cost calc still picks up milk cost
  // when those ingredients exist. Chips always render either way.
  const milks = resolveMilkChoices(ingredients);

  function patch<K extends keyof CartLine>(k: K, v: CartLine[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  const selectedMilkId = draft.milkChoiceId ?? item.defaultMilkId;

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

        <button
          onClick={() => setShowCustomize((s) => !s)}
          className="w-full rounded-xl bg-cream-100 px-3 py-2 text-left text-xs font-medium text-matcha-900/70 hover:bg-cream-200"
        >
          {showCustomize ? "Hide customize" : "Customize"}{" · "}
          sugar, ice, special requests
        </button>

        {showCustomize ? (
          <div className="space-y-3 rounded-xl border border-cream-200 p-3">
            <div>
              <Label>Sugar</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["less", "normal", "extra", "no_agave"] as SugarAdjustment[]).map((s) => (
                  <Chip
                    key={s}
                    active={draft.sugarAdjustment === s}
                    onClick={() => patch("sugarAdjustment", s)}
                  >
                    {s === "less" ? "Less sweet" : s === "normal" ? "Normal" : s === "extra" ? "Extra sweet" : "No agave"}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Label>Ice</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["light", "normal", "extra"] as IceAdjustment[]).map((s) => (
                  <Chip
                    key={s}
                    active={draft.iceAdjustment === s}
                    onClick={() => patch("iceAdjustment", s)}
                  >
                    {s === "light" ? "Light ice" : s === "normal" ? "Normal ice" : "Extra ice"}
                  </Chip>
                ))}
              </div>
            </div>
            <Field label="Special requests">
              <Input
                value={draft.specialRequests ?? ""}
                onChange={(e) => patch("specialRequests", e.target.value)}
                placeholder="e.g. extra hot, no foam"
              />
            </Field>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
