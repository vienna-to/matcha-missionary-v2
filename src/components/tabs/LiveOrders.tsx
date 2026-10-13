"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Plus, ShoppingBag, X } from "lucide-react";
import { Button, EmptyState, Field, Modal, Select, Sheet } from "@/components/ui";
import OrderFlow, { stepIndex, type CartLine, type Step } from "@/components/OrderFlow";
import { useActiveEvent, useStore } from "@/lib/store";
import {
  COMBO_PRICE,
  compareMenuItems,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type PaymentMethod,
} from "@/lib/types";
import { deriveOrderItem, nextOrderNumber } from "@/lib/reducer";
import { newId, nowIso } from "@/lib/id";
import { useHelperMode } from "@/lib/helper-mode";
import { formatMoney } from "@/lib/utils";

/** Landscape iPads and desktops get the order panel as a sidebar; portrait
 *  iPads and phones get it as a bottom sheet. */
function useIsWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

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

  // ---- the order being taken (survives step changes and the sheet closing) ----
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  // Payment method is required at submit time — for tax records we need to
  // know cash/venmo/zelle totals per event, so no silent default.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [step, setStep] = useState<Step>("items");
  const [maxStepIdx, setMaxStepIdx] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [comboPickerOpen, setComboPickerOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [helperMode] = useHelperMode();
  const wide = useIsWide();
  const gridRef = useRef<HTMLDivElement>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  // Removing the last item while on a later step would strand the flow.
  useEffect(() => {
    if (cart.length === 0 && step !== "items") {
      setStep("items");
      setMaxStepIdx(0);
    }
  }, [cart.length, step]);

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
      : snap.menuItems.find((m) => m.id === line.menuItemId)?.price ?? 0;
    const factor = 1 - Math.min(1, Math.max(0, (line.discountPct ?? 0) / 100));
    return sum + unit * factor * line.quantity;
  }, 0);
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  function goStep(next: Step) {
    setStep(next);
    setMaxStepIdx((m) => Math.max(m, stepIndex(next)));
  }

  function addLine(item: MenuItem) {
    setCart((c) => [...c, { cid: newId("cart"), menuItemId: item.id, quantity: 1 }]);
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
  function incrementLine(cid: string, delta: number) {
    const line = cart.find((l) => l.cid === cid);
    if (!line) return;
    updateLine(cid, { quantity: Math.max(1, line.quantity + delta) });
  }

  /** Fresh order, back on step 1 with the menu grid ready to tap. */
  function reset() {
    setCart([]);
    setCustomerName("");
    setNotes("");
    setPaymentMethod("");
    setStep("items");
    setMaxStepIdx(0);
    setSheetOpen(false);
    gridRef.current?.scrollIntoView({ block: "start" });
    gridRef.current?.focus({ preventScroll: true });
  }

  const nameOk = customerName.trim().length > 0;
  const submittable = cart.length > 0 && nameOk && paymentMethod !== "";

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
        activeEvent_.cupSizeOz,
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
      // Captured for tax reports. The narrowed type here is safe because
      // `submittable` requires a payment method.
      paymentMethod: paymentMethod as PaymentMethod,
    };
    dispatch({ type: "SUBMIT_ORDER", order });

    setConfirmation(`Order sent · ${order.customerName} · ${formatMoney(total)}`);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmation(null), 3500);
    reset();
  }

  const flow = (className?: string) => (
    <OrderFlow
      className={className}
      cart={cart}
      snapshot={snap}
      total={total}
      step={step}
      maxStepIdx={maxStepIdx}
      onStep={goStep}
      customerName={customerName}
      setCustomerName={setCustomerName}
      notes={notes}
      setNotes={setNotes}
      paymentMethod={paymentMethod}
      setPaymentMethod={setPaymentMethod}
      onUpdateLine={updateLine}
      onRemoveLine={removeLine}
      onIncrement={incrementLine}
      onOpenCombo={() => setComboPickerOpen(true)}
      onSubmit={submit}
      helperMode={helperMode}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[1fr_400px] lg:gap-6">
      {confirmation ? (
        <div
          role="status"
          className="t-display fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-matcha-600 px-5 py-3 text-sm text-white shadow-lg"
        >
          <Check className="h-4 w-4" /> {confirmation}
        </div>
      ) : null}

      <div ref={gridRef} tabIndex={-1} className="outline-none">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="t-display text-xl">Live Orders</h1>
            <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
              tap a card to add, then follow the steps.
            </p>
          </div>
          <Button variant="outline" className="h-11" onClick={() => setComboPickerOpen(true)}>
            + Combo deal · {formatMoney(COMBO_PRICE)}
          </Button>
        </header>
        <ItemGrid items={activeItems} onAdd={addLine} />
      </div>

      {wide ? (
        // Sidebar (landscape iPad / desktop)
        <aside>
          <div className="sticky top-4">
            {flow("max-h-[calc(100dvh-2rem)] overflow-y-auto")}
          </div>
        </aside>
      ) : (
        // Bottom sheet (portrait iPad / phone). Everything — adjustments
        // included — happens inside this one sheet, so it never closes
        // underneath you.
        <>
          {cart.length > 0 && !sheetOpen ? (
            <button
              onClick={() => setSheetOpen(true)}
              className="t-display fixed bottom-20 left-4 right-4 z-30 flex h-16 items-center justify-between rounded-2xl bg-matcha-500 px-5 text-base text-white shadow-lg active:bg-matcha-600"
            >
              <span className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" />
                Review order · {itemCount}
              </span>
              <span className="tabular-nums">{formatMoney(total)} →</span>
            </button>
          ) : null}
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} side="bottom">
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="t-display text-base">Order</h3>
                <button
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-cream-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {flow("border-0 shadow-none")}
            </div>
          </Sheet>
        </>
      )}

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
          customize the drink&apos;s milk / cream in the adjustments step.
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
          <Button variant="ghost" className="h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-12" onClick={() => onPick(drinkId, pastryId)} disabled={!valid}>
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
            <span className="rounded-full bg-matcha-500 p-2 text-white opacity-90 group-hover:opacity-100">
              <Plus className="h-4 w-4" />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
