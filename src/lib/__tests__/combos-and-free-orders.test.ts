import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeCollected, computeEventTotals } from "@/lib/calc";
import { applyComboSuggestion, comboChoices, findComboSuggestion, pairKey } from "@/lib/combos";
import {
  buildOrder,
  stepChecks,
  validateSubmit,
  type CartLine,
  type OrderDraft,
} from "@/lib/order-steps";
import { initialSeed } from "@/lib/seed";
import { buildFullHistoryCsv } from "@/lib/tax-export";
import { clearSaveErrors, getSaveErrors } from "@/lib/supabase/save-errors";
import { writer } from "@/lib/supabase/writer";
import {
  COMBO_PRICE,
  FREE_REASONS,
  FREE_REASON_LABELS,
  type Event,
  type Ingredient,
  type MenuItem,
  type MenuSnapshot,
} from "@/lib/types";
import { MATCHA_LATTE, WHOLE, makeItem, makeOrder } from "./fixtures";

const T = "2026-01-01T00:00:00.000Z";
const EVENT = { id: "evt-1" } as Event;

const MATCHA: Ingredient = {
  id: "ing-matcha",
  name: "Matcha",
  packagePrice: 30,
  packageAmount: 100,
  unit: "g",
  createdAt: T,
  updatedAt: T,
};
const FLOUR: Ingredient = { ...MATCHA, id: "ing-flour", name: "Flour", packagePrice: 5, packageAmount: 1000 };

const LATTE: MenuItem = {
  ...MATCHA_LATTE,
  price: 7,
  ingredientLines: [{ ingredientId: MATCHA.id, amount: 4, unit: "g" }],
};
const CAKE: MenuItem = {
  ...MATCHA_LATTE,
  id: "mi-cake",
  name: "Cheesecake",
  category: "other",
  size: "pastry_count",
  price: 8,
  ingredientLines: [{ ingredientId: FLOUR.id, amount: 100, unit: "g" }],
};
const COOKIE: MenuItem = { ...CAKE, id: "mi-cookie", name: "Cookie", price: 2 }; // 7 + 2 = 9 < 10
const MERCH: MenuItem = { ...MATCHA_LATTE, id: "mi-tin", name: "Tin", category: "other", size: "other", price: 12 };
const SNAP: MenuSnapshot = {
  id: "s",
  menuItems: [LATTE, CAKE, COOKIE, MERCH],
  ingredients: [WHOLE, MATCHA, FLOUR],
  createdAt: T,
};

const drink = (over: Partial<CartLine> = {}): CartLine => ({
  cid: "d1",
  menuItemId: LATTE.id,
  quantity: 1,
  ...over,
});
const cake = (over: Partial<CartLine> = {}): CartLine => ({
  cid: "p1",
  menuItemId: CAKE.id,
  quantity: 1,
  ...over,
});
const NONE = new Set<string>();

describe("combo suggestion", () => {
  it("suggests a drink + pastry that is cheaper as a combo, showing before and after", () => {
    const s = findComboSuggestion([drink(), cake()], SNAP, NONE);
    expect(s).toMatchObject({ drinkId: LATTE.id, pastryId: CAKE.id, pairs: 1 });
    expect(s?.separateTotal).toBe(15);
    expect(s?.comboTotal).toBe(COMBO_PRICE);
  });

  it("does not suggest when the combo would cost more", () => {
    expect(findComboSuggestion([drink(), cake({ menuItemId: COOKIE.id })], SNAP, NONE)).toBeNull();
  });

  it("does not suggest for lone drinks, lone pastries or unclassifiable items", () => {
    expect(findComboSuggestion([drink()], SNAP, NONE)).toBeNull();
    expect(findComboSuggestion([cake()], SNAP, NONE)).toBeNull();
    expect(findComboSuggestion([drink({ menuItemId: MERCH.id }), cake()], SNAP, NONE)).toBeNull();
  });

  it("skips discounted and free lines, and lines already in a combo", () => {
    expect(findComboSuggestion([drink({ discountPct: 20 }), cake()], SNAP, NONE)).toBeNull();
    expect(findComboSuggestion([drink(), cake({ discountPct: 100 })], SNAP, NONE)).toBeNull();
    expect(
      findComboSuggestion([drink({ isCombo: true, comboPastryId: CAKE.id }), cake()], SNAP, NONE),
    ).toBeNull();
  });

  it("No thanks: the same drink and pastry pair is not offered again", () => {
    const declined = new Set([pairKey(LATTE.id, CAKE.id)]);
    expect(findComboSuggestion([drink(), cake()], SNAP, declined)).toBeNull();
    // A different pair is still offered.
    const other = findComboSuggestion(
      [drink(), cake(), cake({ cid: "p2", menuItemId: CAKE.id })],
      SNAP,
      new Set([pairKey("something", "else")]),
    );
    expect(other).not.toBeNull();
  });

  it("pairs min(drink qty, pastry qty) and leaves the rest alone", () => {
    const cart = [drink({ quantity: 3 }), cake({ quantity: 2 })];
    const s = findComboSuggestion(cart, SNAP, NONE)!;
    expect(s.pairs).toBe(2);
    expect(s.separateTotal).toBe(30);
    expect(s.comboTotal).toBe(20);
    const out = applyComboSuggestion(cart, s);
    const combo = out.find((l) => l.isCombo)!;
    expect(combo.quantity).toBe(2);
    expect(out.filter((l) => !l.isCombo)).toEqual([{ ...drink({ quantity: 1 }) }]);
    // No pastry line left over.
    expect(out.some((l) => l.menuItemId === CAKE.id && !l.isCombo)).toBe(false);

    const out2 = applyComboSuggestion([drink({ quantity: 1 }), cake({ quantity: 4 })], findComboSuggestion([drink(), cake({ quantity: 4 })], SNAP, NONE)!);
    expect(out2.find((l) => !l.isCombo)).toMatchObject({ menuItemId: CAKE.id, quantity: 3 });
  });

  it("converting keeps every customization on the drink and the quantity", () => {
    const custom = drink({
      quantity: 2,
      milkChoiceId: "oat",
      sugarAdjustment: "less",
      iceAdjustment: "extra",
      specialRequests: "extra hot",
    });
    const cart = [custom, cake({ quantity: 2 })];
    const out = applyComboSuggestion(cart, findComboSuggestion(cart, SNAP, NONE)!);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      isCombo: true,
      comboPastryId: CAKE.id,
      menuItemId: LATTE.id,
      quantity: 2,
      milkChoiceId: "oat",
      sugarAdjustment: "less",
      iceAdjustment: "extra",
      specialRequests: "extra hot",
    });
    expect(out[0].discountPct).toBeUndefined();
  });

  it("a pastry request is folded into the combo's request, not lost", () => {
    const cart = [drink({ specialRequests: "no foam" }), cake({ specialRequests: "warm it" })];
    const out = applyComboSuggestion(cart, findComboSuggestion(cart, SNAP, NONE)!);
    expect(out[0].specialRequests).toBe("no foam; Pastry: warm it");
    const onlyPastry = applyComboSuggestion(
      [drink(), cake({ specialRequests: "warm it" })],
      findComboSuggestion([drink(), cake()], SNAP, NONE)!,
    );
    expect(onlyPastry[0].specialRequests).toBe("Pastry: warm it");
  });

  it("revenue becomes the combo price; COGS (drink + pastry) is unchanged", () => {
    const draftOf = (cart: CartLine[]): OrderDraft => ({
      cart,
      snapshot: SNAP,
      customerName: "A",
      notes: "",
      paymentMethod: "cash",
    });
    const ctx = { orderId: "o", orderNumber: 1, submittedAt: T, event: EVENT };
    const separate = [drink({ quantity: 2 }), cake({ quantity: 2 })];
    const combined = applyComboSuggestion(separate, findComboSuggestion(separate, SNAP, NONE)!);

    const before = computeEventTotals(SNAP, [], [buildOrder(draftOf(separate), ctx)]);
    const after = computeEventTotals(SNAP, [], [buildOrder(draftOf(combined), ctx)]);
    expect(before.revenuePaid).toBe(2 * (7 + 8));
    expect(after.revenuePaid).toBe(2 * COMBO_PRICE);
    expect(after.ingredientCost).toBeGreaterThan(0);
    expect(after.ingredientCost).toBeCloseTo(before.ingredientCost, 9);
  });
});

describe("combo dropdowns", () => {
  it("drinks list has only drinks, pastries list only pastries; unclassifiable items are in neither", () => {
    const { drinks, pastries, unclassified } = comboChoices(SNAP.menuItems);
    expect(drinks.map((m) => m.id)).toEqual([LATTE.id]);
    expect(pastries.map((m) => m.id).sort()).toEqual([CAKE.id, COOKIE.id].sort());
    expect(unclassified).toBe(1);
  });
});

describe("free orders", () => {
  const ctx = { orderId: "o", orderNumber: 1, submittedAt: T, event: EVENT };
  const free = [drink({ discountPct: 100 })];
  const base = { snapshot: SNAP, customerName: "", notes: "" };

  it("a $0 order needs no payment method", () => {
    expect(validateSubmit({ cart: free, paymentMethod: "", itemsTotal: 0 })).toEqual({ ok: true });
  });

  it("a paid order still needs one", () => {
    expect(validateSubmit({ cart: [drink()], paymentMethod: "", itemsTotal: 7 })).toMatchObject({
      ok: false,
      step: "payment",
    });
  });

  it("a tip on a free order needs a tip method", () => {
    expect(
      validateSubmit({ cart: free, paymentMethod: "", itemsTotal: 0, tipAmount: 1 }),
    ).toMatchObject({ ok: false, step: "payment", message: "Pick how the tip was paid." });
    expect(
      validateSubmit({ cart: free, paymentMethod: "", itemsTotal: 0, tipAmount: 1, tipPaymentMethod: "venmo" }),
    ).toEqual({ ok: true });
  });

  it("a free order stores no payment method (never a made-up one) and is marked comped", () => {
    const o = buildOrder({ ...base, cart: free, paymentMethod: "" }, ctx);
    expect(o.paymentMethod).toBeUndefined();
    expect(o.paymentStatus).toBe("comped");
    // A method picked before the order became free is dropped, not kept.
    const stale = buildOrder({ ...base, cart: free, paymentMethod: "cash" }, ctx);
    expect(stale.paymentMethod).toBeUndefined();
  });

  it("a tip on a free order keeps its own method", () => {
    const o = buildOrder(
      { ...base, cart: free, paymentMethod: "", tipAmount: 2, tipPaymentMethod: "zelle" },
      ctx,
    );
    expect(o.paymentMethod).toBeUndefined();
    expect(o.tipAmount).toBe(2);
    expect(o.tipPaymentMethod).toBe("zelle");
  });

  it("a paid order is stored as paid with its method", () => {
    const o = buildOrder({ ...base, cart: [drink()], paymentMethod: "venmo" }, ctx);
    expect(o.paymentMethod).toBe("venmo");
    expect(o.paymentStatus).toBe("paid");
  });

  it("the payment step check reflects real input on a free order", () => {
    const d = (over: Partial<OrderDraft>): OrderDraft => ({ ...base, cart: free, paymentMethod: "", ...over });
    expect(stepChecks(d({})).payment).toBe(false);
    expect(stepChecks(d({ tipAmount: 1, tipPaymentMethod: "venmo" })).payment).toBe(true);
  });

  it("free orders do not appear in the payment-method breakdown", () => {
    const freeOrder = buildOrder({ ...base, cart: free, paymentMethod: "" }, { ...ctx, orderId: "f" });
    const paid = buildOrder({ ...base, cart: [drink()], paymentMethod: "cash" }, { ...ctx, orderId: "p", orderNumber: 2 });
    const c = computeCollected([freeOrder, paid], []);
    expect(c.byMethod.map((b) => b.method)).toEqual(["cash"]);
    expect(c.salesRevenue).toBe(7);
    // A free order with a tip shows up only under the tip's method.
    const tipped = buildOrder(
      { ...base, cart: free, paymentMethod: "", tipAmount: 2, tipPaymentMethod: "venmo" },
      { ...ctx, orderId: "t", orderNumber: 3 },
    );
    const c2 = computeCollected([freeOrder, paid, tipped], []);
    expect(c2.byMethod.map((b) => [b.method, b.total])).toEqual([
      ["venmo", 2],
      ["cash", 7],
    ]);
  });

  it("a method left on an order that was later made free is not counted", () => {
    const o = makeOrder({ paymentMethod: "venmo", items: [makeItem({ priceCharged: 0, listPrice: 7, discountPct: 100 })] });
    expect(computeCollected([o], []).byMethod).toEqual([]);
  });
});

describe("friend as a free reason", () => {
  it("is a valid reason with a label", () => {
    expect(FREE_REASONS).toContain("friend");
    expect(FREE_REASON_LABELS.friend).toBe("Friend");
  });

  it("the full-history CSV prints the label", () => {
    const state = initialSeed();
    const o = state.orders[0];
    o.items[0] = { ...o.items[0], discountPct: 100, priceCharged: 0, freeReason: "friend" };
    const csv = buildFullHistoryCsv(state);
    expect(csv).toMatch(/,Friend(\r?\n|,)/);
  });
});

describe("a free reason the database does not accept yet is reported", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearSaveErrors();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearSaveErrors();
  });

  it("friend before migration-free-reason-friend.sql: order saves, error shown", async () => {
    const rejected = {
      error: {
        code: "23514",
        message: 'new row violates check constraint "order_items_free_reason_check" (free_reason)',
      },
    };
    const client = {
      rpc: () => Promise.resolve(rejected),
      from: (table: string) => ({
        insert: (rows: unknown) =>
          Promise.resolve(
            table === "order_items" && "free_reason" in (rows as Array<Record<string, unknown>>)[0]
              ? rejected
              : { error: null },
          ),
        delete: () => {
          const chain = { eq: () => chain, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
          return chain;
        },
      }),
    } as unknown as SupabaseClient;
    const order = makeOrder({
      items: [makeItem({ discountPct: 100, priceCharged: 0, listPrice: 7, freeReason: "friend" })],
    });
    const p = writer(client, "ws").submitOrder(order);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ finalOrderNumber: 1 });
    expect(getSaveErrors().map((e) => e.message).join(" ")).toMatch(/free reason could not be saved/);
    expect(getSaveErrors().map((e) => e.message).join(" ")).toMatch(/migration-free-reason-friend\.sql/);
  });
});
