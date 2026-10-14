import { describe, expect, it } from "vitest";
import { deriveOrderItem } from "@/lib/reducer";
import { hasDrinkAdjustments } from "@/lib/order-labels";
import {
  buildOrder,
  stepChecks,
  validateSubmit,
  type CartLine,
  type OrderDraft,
} from "@/lib/order-steps";
import type { Event, MenuItem, MenuSnapshot } from "@/lib/types";
import { MATCHA_LATTE, SNAPSHOT, WHOLE } from "./fixtures";

const CHEESECAKE: MenuItem = {
  ...MATCHA_LATTE,
  id: "mi-cake",
  name: "Matcha Cheesecake",
  category: "pastry",
  size: "pastry_count",
  price: 8,
  // Even a pastry that (wrongly) carries a default milk must not save one.
  defaultMilkId: WHOLE.id,
};
const SNAP: MenuSnapshot = { ...SNAPSHOT, menuItems: [MATCHA_LATTE, CHEESECAKE] };
const EVENT = { id: "evt-1" } as Event;

const drinkLine = (over: Partial<CartLine> = {}): CartLine => ({
  cid: "c1",
  menuItemId: MATCHA_LATTE.id,
  quantity: 1,
  ...over,
});
const cakeLine = (over: Partial<CartLine> = {}): CartLine => ({
  cid: "c2",
  menuItemId: CHEESECAKE.id,
  quantity: 1,
  ...over,
});
const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  cart: [],
  snapshot: SNAP,
  customerName: "",
  notes: "",
  paymentMethod: "",
  ...over,
});

describe("pastries take no drink adjustments", () => {
  it("is driven by category or Pastry size, never by name", () => {
    const namedPastry: MenuItem = { ...MATCHA_LATTE, name: "Pastry Latte" };
    expect(hasDrinkAdjustments(CHEESECAKE)).toBe(false);
    expect(hasDrinkAdjustments({ ...MATCHA_LATTE, category: "pastry" })).toBe(false);
    expect(hasDrinkAdjustments(MATCHA_LATTE)).toBe(true);
    expect(hasDrinkAdjustments(namedPastry)).toBe(true);
  });

  it("an item set to the Pastry size in Menu Manager counts, even with category 'other'", () => {
    // This is how real pastries are stored: Menu Manager only sets size.
    const real = { ...CHEESECAKE, category: "other" as const, size: "pastry_count" as const };
    expect(hasDrinkAdjustments(real)).toBe(false);
    const item = deriveOrderItem(
      { menuItemId: real.id, quantity: 1, sugarAdjustment: "less", specialRequests: "warm" },
      "ord-1",
      { ...SNAP, menuItems: [MATCHA_LATTE, real] },
    );
    expect(item.sugarAdjustment).toBeUndefined();
    expect(item.milkNameSnap).toBeUndefined();
    expect(item.specialRequests).toBe("warm");
  });

  it("saves a pastry with no milk/cream/sugar/ice but keeps its special request", () => {
    const item = deriveOrderItem(
      {
        menuItemId: CHEESECAKE.id,
        quantity: 1,
        milkChoiceId: WHOLE.id,
        creamChoiceId: "none",
        sugarAdjustment: "less",
        iceAdjustment: "extra",
        specialRequests: "warm it up",
      },
      "ord-1",
      SNAP,
    );
    expect(item.milkChoiceId).toBeUndefined();
    expect(item.creamChoiceId).toBeUndefined();
    expect(item.milkNameSnap).toBeUndefined();
    expect(item.creamNameSnap).toBeUndefined();
    expect(item.sugarAdjustment).toBeUndefined();
    expect(item.iceAdjustment).toBeUndefined();
    expect(item.specialRequests).toBe("warm it up");
  });

  it("leaves drink adjustments untouched", () => {
    const item = deriveOrderItem(
      {
        menuItemId: MATCHA_LATTE.id,
        quantity: 1,
        sugarAdjustment: "less",
        iceAdjustment: "light",
        specialRequests: "extra hot",
      },
      "ord-1",
      SNAP,
    );
    expect(item.milkNameSnap).toBe("Whole milk");
    expect(item.sugarAdjustment).toBe("less");
    expect(item.iceAdjustment).toBe("light");
    expect(item.specialRequests).toBe("extra hot");
  });
});

describe("step checkmarks reflect real input only", () => {
  it("nothing is checked on an empty draft", () => {
    expect(stepChecks(draft())).toEqual({
      items: false,
      adjust: false,
      name: false,
      payment: false,
    });
  });

  it("items: checked with an item, cleared when the cart is emptied", () => {
    expect(stepChecks(draft({ cart: [drinkLine()] })).items).toBe(true);
    expect(stepChecks(draft({ cart: [] })).items).toBe(false);
  });

  it("name: checked only when non-blank, cleared when erased", () => {
    expect(stepChecks(draft({ customerName: "Sam" })).name).toBe(true);
    expect(stepChecks(draft({ customerName: "   " })).name).toBe(false);
    expect(stepChecks(draft({ customerName: "" })).name).toBe(false);
  });

  it("payment: checked once a method is selected", () => {
    expect(stepChecks(draft({ paymentMethod: "cash" })).payment).toBe(true);
    expect(stepChecks(draft({ paymentMethod: "" })).payment).toBe(false);
  });

  it("adjustments: only a change from default counts, and resetting clears it", () => {
    // Viewing / default selections are not input.
    expect(stepChecks(draft({ cart: [drinkLine()] })).adjust).toBe(false);
    expect(
      stepChecks(draft({ cart: [drinkLine({ milkChoiceId: WHOLE.id })] })).adjust,
    ).toBe(false); // picked the default milk again
    expect(stepChecks(draft({ cart: [drinkLine({ sugarAdjustment: "normal" })] })).adjust).toBe(false);
    // Real changes.
    expect(stepChecks(draft({ cart: [drinkLine({ milkChoiceId: "other-milk" })] })).adjust).toBe(true);
    expect(stepChecks(draft({ cart: [drinkLine({ sugarAdjustment: "less" })] })).adjust).toBe(true);
    expect(stepChecks(draft({ cart: [drinkLine({ iceAdjustment: "extra" })] })).adjust).toBe(true);
    expect(stepChecks(draft({ cart: [drinkLine({ specialRequests: "no foam" })] })).adjust).toBe(true);
    // Reset to default => check goes away.
    expect(stepChecks(draft({ cart: [drinkLine({ sugarAdjustment: undefined })] })).adjust).toBe(false);
    expect(stepChecks(draft({ cart: [drinkLine({ specialRequests: "  " })] })).adjust).toBe(false);
  });

  it("adjustments: a pastry only counts via its special request", () => {
    expect(stepChecks(draft({ cart: [cakeLine({ sugarAdjustment: "less" })] })).adjust).toBe(false);
    expect(stepChecks(draft({ cart: [cakeLine({ specialRequests: "warm" })] })).adjust).toBe(true);
  });
});

describe("submit requirements", () => {
  it("blocks with no items and jumps to Items", () => {
    const r = validateSubmit({ cart: [], paymentMethod: "cash", itemsTotal: 0 });
    expect(r).toMatchObject({ ok: false, step: "items" });
  });

  it("blocks with no payment method and jumps to Payment", () => {
    const r = validateSubmit({ cart: [drinkLine()], paymentMethod: "", itemsTotal: 7 });
    expect(r).toMatchObject({ ok: false, step: "payment" });
  });

  it("items are checked before payment when both are missing", () => {
    expect(validateSubmit({ cart: [], paymentMethod: "", itemsTotal: 0 })).toMatchObject({ step: "items" });
  });

  it("succeeds with no name and no adjustments", () => {
    const d = draft({ cart: [drinkLine()], paymentMethod: "cash" });
    expect(validateSubmit({ ...d, itemsTotal: 7 })).toEqual({ ok: true });
    const order = buildOrder(
      { ...d, paymentMethod: "cash" },
      { orderId: "ord-9", orderNumber: 4, submittedAt: "2026-01-01T00:00:00.000Z", event: EVENT },
    );
    expect(order.customerName).toBe("No name");
    expect(order.items).toHaveLength(1);
    expect(order.items[0].menuItemNameSnap).toBe("Matcha Latte");
    expect(order.notes).toBeUndefined();
    expect(order.paymentMethod).toBe("cash");
  });
});
