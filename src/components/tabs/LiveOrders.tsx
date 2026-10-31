"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Plus, ShoppingBag, X } from "lucide-react";
import { Button, EmptyState, Field, Modal, Select, Sheet } from "@/components/ui";
import OrderFlow from "@/components/OrderFlow";
import CustomItemModal, { CustomBuilder, EMPTY_SPEC } from "@/components/CustomItemModal";
import { comboUnitPrice, customItemId, customItemPrice, isValidCustomSpec, type CustomSpec } from "@/lib/custom-item";
import {
  amountOwed,
  buildOrder,
  cartTotal,
  extraAmount,
  NO_EXTRA,
  stepChecks,
  type ExtraDraft,
  validateSubmit,
  type CartLine,
  type Step,
} from "@/lib/order-steps";
import { useActiveEvent, useStore } from "@/lib/store";
import {
  applyComboSuggestion,
  comboChoices,
  findComboSuggestion,
  pairKey,
  type ComboSuggestion,
} from "@/lib/combos";
import {
  COMBO_PRICE,
  compareMenuItems,
  type MenuItem,
  type MenuSnapshot,
  type PaymentMethod,
} from "@/lib/types";
import { nextOrderNumber } from "@/lib/reducer";
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
  const [extra, setExtra] = useState<ExtraDraft>(NO_EXTRA);
  const [step, setStep] = useState<Step>("items");
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [comboPickerOpen, setComboPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  // Combo suggestion: the pair being offered, and pairs the customer said
  // "No thanks" to (for this order only; cleared by reset()).
  const [suggestion, setSuggestion] = useState<ComboSuggestion | null>(null);
  const [declinedPairs, setDeclinedPairs] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [helperMode] = useHelperMode();
  const wide = useIsWide();
  const gridRef = useRef<HTMLDivElement>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

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
  const total = cartTotal(cart, snap);
  // Round up is against what the customer owes at checkout. No sales tax is
  // added at checkout in this app, so that is the items total.
  const owed = amountOwed(total);
  const extraDollars = extraAmount(extra, owed);
  const checks = stepChecks({
    cart,
    snapshot: snap,
    customerName,
    notes,
    paymentMethod,
    tipAmount: extraDollars,
    tipPaymentMethod: extra.method,
  });
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  /** Offer a combo if the cart has a drink and a pastry that would be cheaper
   *  bundled. Returns true when a popup was opened. */
  function offerCombo(): boolean {
    const s = findComboSuggestion(cart, snap, new Set(declinedPairs));
    if (s) setSuggestion(s);
    return Boolean(s);
  }

  function goStep(next: Step) {
    // Leaving the Items step is the moment the customer has finished picking.
    if (step === "items" && next !== "items") offerCombo();
    setStep(next);
    setNotice(null);
  }

  function addLine(item: MenuItem) {
    setNotice(null);
    setCart((c) => [...c, { cid: newId("cart"), menuItemId: item.id, quantity: 1 }]);
  }

  function addCustom(menuItemId: string) {
    setNotice(null);
    setCart((c) => [...c, { cid: newId("cart"), menuItemId, quantity: 1 }]);
    setCustomOpen(false);
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
    // Minus at quantity 1 removes the line instead of doing nothing.
    if (line.quantity + delta < 1) {
      removeLine(cid);
      return;
    }
    updateLine(cid, { quantity: line.quantity + delta });
  }

  /** Fresh order, back on step 1 with the menu grid ready to tap. */
  function reset() {
    setCart([]);
    setCustomerName("");
    setNotes("");
    setPaymentMethod("");
    setExtra(NO_EXTRA);
    setDeclinedPairs([]);
    setSuggestion(null);
    setStep("items");
    setNotice(null);
    setSheetOpen(false);
    gridRef.current?.scrollIntoView({ block: "start" });
    gridRef.current?.focus({ preventScroll: true });
  }

  function submit() {
    // One last chance to bundle a pair added after the Items step. Nothing is
    // submitted this tap; the popup answers first, then Confirm again.
    if (cart.length > 0 && offerCombo()) return;
    // Only an item and a payment method are required; name and adjustments
    // are optional. If one is missing, say so and jump to that step.
    const check = validateSubmit({
      cart,
      paymentMethod,
      itemsTotal: total,
      tipAmount: extraDollars,
      tipPaymentMethod: extra.method,
    });
    if (!check.ok) {
      setStep(check.step);
      setNotice(check.message);
      return;
    }
    // Build the full Order in the caller so the dispatch wrapper can write to
    // Supabase without re-reading stateRef (which races on rapid submits).
    const order = buildOrder(
      {
        cart,
        snapshot: snap,
        customerName,
        notes,
        paymentMethod,
        tipAmount: extraDollars,
        tipPaymentMethod: extra.method,
      },
      {
        orderId: newId("ord"),
        orderNumber: nextOrderNumber(state, activeEvent_.id),
        submittedAt: nowIso(),
        event: activeEvent_,
      },
    );
    dispatch({ type: "SUBMIT_ORDER", order });

    setConfirmation(
      `Order sent · ${order.customerName} · ${formatMoney(total + extraDollars)}`,
    );
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
      extra={extra}
      setExtra={setExtra}
      extraDollars={extraDollars}
      step={step}
      checks={checks}
      notice={notice}
      onStep={goStep}
      customerName={customerName}
      setCustomerName={setCustomerName}
      notes={notes}
      setNotes={setNotes}
      paymentMethod={paymentMethod}
      setPaymentMethod={(m) => {
        setNotice(null);
        setPaymentMethod(m);
      }}
      onUpdateLine={updateLine}
      onRemoveLine={removeLine}
      onIncrement={incrementLine}
      onSubmit={submit}
      helperMode={helperMode}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_clamp(340px,31vw,352px)] lg:gap-6">
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
          <div className="flex flex-wrap gap-2 max-md:w-full">
            <Button variant="outline" className="h-11 max-md:h-auto max-md:min-h-11 max-md:flex-1 max-md:whitespace-normal max-md:py-2" onClick={() => setCustomOpen(true)}>
              + Custom drink
            </Button>
            <Button variant="outline" className="h-11 max-md:h-auto max-md:min-h-11 max-md:flex-1 max-md:whitespace-normal max-md:py-2" onClick={() => setComboPickerOpen(true)}>
              + Combo deal · {formatMoney(COMBO_PRICE)}
            </Button>
          </div>
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
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} side="bottom" label="Current order">
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

      {suggestion ? (
        <ComboSuggestModal
          suggestion={suggestion}
          snapshot={snap}
          onAccept={() => {
            setCart((c) => applyComboSuggestion(c, suggestion));
            setSuggestion(null);
          }}
          onDecline={() => {
            setDeclinedPairs((d) => [...d, pairKey(suggestion.drinkId, suggestion.pastryId)]);
            setSuggestion(null);
          }}
        />
      ) : null}

      {customOpen ? (
        <CustomItemModal
          snapshot={snap}
          cupSizeOz={activeEvent_.cupSizeOz}
          helperMode={helperMode}
          onAdd={addCustom}
          onClose={() => setCustomOpen(false)}
        />
      ) : null}

      {comboPickerOpen ? (
        <ComboPickerModal
          items={activeItems}
          snapshot={snap}
          cupSizeOz={activeEvent_.cupSizeOz}
          helperMode={helperMode}
          onClose={() => setComboPickerOpen(false)}
          onPick={addCombo}
        />
      ) : null}
    </div>
  );
}

const CUSTOM_DRINK_OPTION = "__custom__";

function ComboPickerModal({
  items,
  snapshot,
  cupSizeOz,
  helperMode,
  onClose,
  onPick,
}: {
  items: MenuItem[];
  snapshot: MenuSnapshot;
  cupSizeOz?: number;
  helperMode: boolean;
  onClose: () => void;
  onPick: (drinkId: string, pastryId: string) => void;
}) {
  // Drinks and pastries are told apart by the menu's own classification (see
  // comboChoices); each dropdown shows only its own kind.
  const { drinks, pastries, unclassified } = useMemo(() => comboChoices(items), [items]);

  const [drinkId, setDrinkId] = useState<string>(drinks[0]?.id ?? "");
  const [pastryId, setPastryId] = useState<string>(pastries[0]?.id ?? "");

  const isCustom = drinkId === CUSTOM_DRINK_OPTION;
  const [spec, setSpec] = useState<CustomSpec>(EMPTY_SPEC);
  const customId = customItemId(spec);
  const drink = isCustom ? undefined : drinks.find((m) => m.id === drinkId);
  const pastry = pastries.find((m) => m.id === pastryId);
  // $10 covers a custom drink with up to one topping; each extra topping adds $0.20.
  const comboPrice = isCustom ? comboUnitPrice(customId) : COMBO_PRICE;
  const drinkPrice = isCustom ? customItemPrice(spec.toppingIds.length) : drink?.price ?? 0;
  const savings = drinkPrice + (pastry?.price ?? 0) - comboPrice;
  const valid = Boolean(pastry) && (isCustom ? isValidCustomSpec(spec) : Boolean(drink));

  return (
    <Modal open onClose={onClose} title={`Combo deal: ${formatMoney(COMBO_PRICE)}`}>
      <div className="space-y-3">
        <p className="t-caption text-xs text-matcha-900/60">
          pick a drink and a pastry. the bundle is fixed at {formatMoney(COMBO_PRICE)}.
          customize the drink&apos;s milk in the adjustments step.
        </p>
        <Field label="drink">
          <Select value={drinkId} onChange={(e) => setDrinkId(e.target.value)}>
            {drinks.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.name} · ${formatMoney(m.price)}`.toUpperCase()}
              </option>
            ))}
            <option value={CUSTOM_DRINK_OPTION}>CUSTOM DRINK…</option>
          </Select>
        </Field>
        {isCustom ? (
          <CustomBuilder
            snapshot={snapshot}
            cupSizeOz={cupSizeOz}
            helperMode={helperMode}
            spec={spec}
            onChange={setSpec}
            priceLabel="combo price"
            priceOverride={comboPrice}
          />
        ) : null}
        <Field label="pastry">
          <Select value={pastryId} onChange={(e) => setPastryId(e.target.value)}>
            {pastries.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.name} · ${formatMoney(m.price)}`.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        {(drinks.length === 0 && !isCustom) || pastries.length === 0 ? (
          <p role="alert" className="t-caption text-xs font-semibold text-red-700">
            {drinks.length === 0 ? "No drinks on the menu. " : ""}
            {pastries.length === 0
              ? "No pastries on the menu. Set an item's Size to Pastry in Menu Manager."
              : ""}
          </p>
        ) : null}
        {unclassified > 0 ? (
          <p className="t-caption text-xs text-matcha-900/60">
            {unclassified} item{unclassified === 1 ? "" : "s"} can&apos;t be used in a combo. Set their Size in
            Menu Manager.
          </p>
        ) : null}
        <div className="t-caption flex items-center justify-between rounded-xl bg-matcha-50 px-3 py-2 text-xs text-matcha-900/80">
          <span>combo price</span>
          <span className="tabular-nums">
            {formatMoney(comboPrice)}
            {savings > 0 ? (
              <span className="ml-2 text-matcha-700">(save {formatMoney(savings)})</span>
            ) : null}
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-12" onClick={() => onPick(isCustom ? customId : drinkId, pastryId)} disabled={!valid}>
            Add combo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** "Make this a combo?" shown when a drink and a pastry in the order would be
 *  cheaper bundled. */
function ComboSuggestModal({
  suggestion,
  snapshot,
  onAccept,
  onDecline,
}: {
  suggestion: ComboSuggestion;
  snapshot: MenuSnapshot;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const drink = snapshot.menuItems.find((m) => m.id === suggestion.drinkId);
  const pastry = snapshot.menuItems.find((m) => m.id === suggestion.pastryId);
  const n = suggestion.pairs;
  return (
    <Modal open onClose={onDecline} title="Make it a combo?">
      <div className="space-y-4">
        <div className="rounded-xl bg-cream-100 px-4 py-3">
          <div className="t-display text-base">
            {n > 1 ? `${n} × ` : ""}
            {drink?.name} + {pastry?.name}
          </div>
          <div className="t-caption mt-1 text-sm text-matcha-900/70">
            <span className="tabular-nums">{formatMoney(suggestion.separateTotal)}</span> separately,{" "}
            <span className="tabular-nums">{formatMoney(suggestion.comboTotal)}</span> combo
            {n > 1 ? ` (${n} combos)` : ""}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button size="lg" className="h-14 flex-1 text-base" onClick={onAccept}>
            Make it a combo
          </Button>
          <Button variant="outline" size="lg" className="h-14 flex-1 text-base" onClick={onDecline}>
            No thanks
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onAdd(item)}
          className="group relative flex h-44 min-w-0 flex-col rounded-2xl border border-cream-200 bg-white p-4 text-left transition-all hover:border-matcha-300 hover:shadow-md active:scale-[0.98]"
        >
          <div className="min-w-0">
            <div className="t-display hyphens-auto break-words text-sm leading-tight [overflow-wrap:anywhere]">
              {item.name}
            </div>
            {item.description ? (
              <div className="t-caption mt-2 line-clamp-3 text-xs text-matcha-900/60">
                {item.description}
              </div>
            ) : null}
          </div>
          <div className="mt-auto flex items-end justify-between gap-2">
            <div className="text-base font-semibold tabular-nums">
              {formatMoney(item.price)}
            </div>
            <span className="shrink-0 rounded-full bg-matcha-500 p-2 text-white opacity-90 group-hover:opacity-100">
              <Plus className="h-4 w-4" />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
