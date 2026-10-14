import { COMBO_PRICE } from "./types";
import { chargedUnitFromPct, roundUpExtra } from "./pricing";
import type {
  Event,
  FreeReason,
  IceAdjustment,
  MenuSnapshot,
  Order,
  PaymentMethod,
  SugarAdjustment,
} from "./types";
import { hasDrinkAdjustments } from "./order-labels";
import { deriveOrderItem } from "./reducer";

export type CartLine = {
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
  /** Optional reason when the line is free (100% off). */
  freeReason?: FreeReason;
  /** Combo deal: priced at COMBO_PRICE, bundles drink (menuItemId) + pastry. */
  isCombo?: boolean;
  comboPastryId?: string;
};

/** Items › Adjustments › Name › Payment. */
export type Step = "items" | "adjust" | "name" | "payment";
export const STEPS: Array<{ id: Step; label: string }> = [
  { id: "items", label: "Items" },
  { id: "adjust", label: "Adjustments" },
  { id: "name", label: "Name" },
  { id: "payment", label: "Payment" },
];
export const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);

export const NO_NAME_LABEL = "No name";

export type OrderDraft = {
  cart: CartLine[];
  snapshot: MenuSnapshot;
  customerName: string;
  notes: string;
  paymentMethod: PaymentMethod | "";
  /** Extra money on top of the items (round-up / tip). Not part of any item
   *  price or revenue. */
  tipAmount?: number;
  /** How the extra is paid. "" or the order's own method = same as order. */
  tipPaymentMethod?: PaymentMethod | "";
};

// ---------- extra money (round-up / tip) at order entry ----------

export type ExtraMode = "none" | "round" | "plus1" | "plus2" | "custom";
export type ExtraDraft = {
  mode: ExtraMode;
  /** Dollars, used when mode is "custom". */
  custom: number;
  /** "" = same as the order's payment method. */
  method: PaymentMethod | "";
};
export const NO_EXTRA: ExtraDraft = { mode: "none", custom: 0, method: "" };

/**
 * What the customer owes at checkout: the items total plus any sales tax added
 * at checkout. The app does not add tax at checkout today, so `tax` is 0; the
 * parameter keeps the round-up correct if that is ever added.
 */
export function amountOwed(itemsTotal: number, tax = 0): number {
  return itemsTotal + tax;
}

/** Resolve the chosen extra to dollars, against what the customer owes. */
export function extraAmount(d: ExtraDraft, owed: number): number {
  switch (d.mode) {
    case "round":
      return roundUpExtra(owed);
    case "plus1":
      return 1;
    case "plus2":
      return 2;
    case "custom":
      return Number.isFinite(d.custom) && d.custom > 0 ? Math.round(d.custom * 100) / 100 : 0;
    default:
      return 0;
  }
}

/**
 * Which steps show a checkmark. A step is checked only when it holds real
 * input (not merely because it was viewed), and the check disappears when
 * that input is removed.
 */
export function stepChecks(d: OrderDraft): Record<Step, boolean> {
  const adjusted = d.cart.some((l) => {
    if (l.specialRequests?.trim()) return true;
    const item = d.snapshot.menuItems.find((m) => m.id === l.menuItemId);
    if (!hasDrinkAdjustments(item)) return false;
    // "Changed from default": choosing the default again is not a change.
    const milkChanged = l.milkChoiceId !== undefined && l.milkChoiceId !== item?.defaultMilkId;
    const creamChanged = l.creamChoiceId !== undefined && l.creamChoiceId !== item?.defaultCreamId;
    const sugarChanged = l.sugarAdjustment !== undefined && l.sugarAdjustment !== "normal";
    const iceChanged = l.iceAdjustment !== undefined && l.iceAdjustment !== "normal";
    return milkChanged || creamChanged || sugarChanged || iceChanged;
  });
  return {
    items: d.cart.length > 0,
    adjust: adjusted || d.notes.trim().length > 0,
    name: d.customerName.trim().length > 0,
    payment: d.paymentMethod !== "",
  };
}

export type SubmitCheck = { ok: true } | { ok: false; step: Step; message: string };

/** The only hard requirements: something to make, and a way to reconcile it.
 *  A missing name or untouched adjustments never block an order. */
export function validateSubmit(d: Pick<OrderDraft, "cart" | "paymentMethod">): SubmitCheck {
  if (d.cart.length === 0) {
    return { ok: false, step: "items", message: "Add at least one item before confirming." };
  }
  if (d.paymentMethod === "") {
    return { ok: false, step: "payment", message: "Pick a payment method to confirm." };
  }
  return { ok: true };
}

/** Cart total with combo pricing and per-line discounts. */
export function cartTotal(cart: CartLine[], snapshot: MenuSnapshot): number {
  return cart.reduce((sum, line) => {
    const unit = line.isCombo
      ? COMBO_PRICE
      : snapshot.menuItems.find((m) => m.id === line.menuItemId)?.price ?? 0;
    return sum + chargedUnitFromPct(unit, line.discountPct) * line.quantity;
  }, 0);
}

/** Build the Order to submit. Caller must have passed validateSubmit. */
export function buildOrder(
  d: OrderDraft & { paymentMethod: PaymentMethod },
  ctx: { orderId: string; orderNumber: number; submittedAt: string; event: Event },
): Order {
  const items = d.cart.map((l) =>
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
        freeReason: l.freeReason,
        isCombo: l.isCombo,
        comboPastryId: l.comboPastryId,
        status: "pending",
      },
      ctx.orderId,
      d.snapshot,
      ctx.event.cupSizeOz,
    ),
  );
  return {
    id: ctx.orderId,
    eventId: ctx.event.id,
    orderNumber: ctx.orderNumber,
    // The name is optional; store an explicit label so the queue and
    // reconciliation never show a blank.
    customerName: d.customerName.trim() || NO_NAME_LABEL,
    items,
    notes: d.notes.trim() || undefined,
    submittedAt: ctx.submittedAt,
    updatedAt: ctx.submittedAt,
    // Orders are pending until the barista checks all items off. Legacy
    // paymentStatus kept so the DB column has a value.
    status: "pending",
    paymentStatus: "paid",
    paymentMethod: d.paymentMethod,
    // Stored only when there is an extra; the method only when it differs from
    // the order's own (null/undefined means "same as the order").
    tipAmount: d.tipAmount && d.tipAmount > 0 ? d.tipAmount : undefined,
    tipPaymentMethod:
      d.tipAmount && d.tipAmount > 0 && d.tipPaymentMethod && d.tipPaymentMethod !== d.paymentMethod
        ? d.tipPaymentMethod
        : undefined,
  };
}
