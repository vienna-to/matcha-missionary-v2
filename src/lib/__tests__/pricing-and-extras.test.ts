import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCollected,
  computeEventTotals,
  computeItemTotals,
  expandCombosInByItem,
} from "@/lib/calc";
import { deriveOrderItem } from "@/lib/reducer";
import {
  amountOwed,
  buildOrder,
  extraAmount,
  NO_EXTRA,
  type CartLine,
} from "@/lib/order-steps";
import {
  chargedUnit,
  listUnit,
  normalizeItemPatch,
  priceKind,
  roundUpExtra,
} from "@/lib/pricing";
import { toOrderInsert, toOrderItemInsert, toOrderPatch } from "@/lib/supabase/serialize";
import { clearSaveErrors, getSaveErrors } from "@/lib/supabase/save-errors";
import { writer } from "@/lib/supabase/writer";
import type { Event, EventExtra, FixedCost, MenuItem, MenuSnapshot, Order, OrderItem } from "@/lib/types";
import { MATCHA_LATTE, SNAPSHOT, WHOLE, makeItem, makeOrder } from "./fixtures";

const T = "2026-01-01T00:00:00.000Z";
const EVENT = { id: "evt-1" } as Event;

// ---------------------------------------------------------------------------
// An existing event, as it looked BEFORE this change: only priceSnap and
// discountPct on each line, no listPrice / priceCharged / tip.
// ---------------------------------------------------------------------------

const MATCHA_TIN: MenuItem = { ...MATCHA_LATTE, id: "mi-tin", name: "Matcha Tin", price: 12 };
const CAKE: MenuItem = {
  ...MATCHA_LATTE,
  id: "mi-cake",
  name: "Cheesecake",
  price: 8,
  size: "pastry_count",
};
const SNAP: MenuSnapshot = { ...SNAPSHOT, menuItems: [MATCHA_LATTE, MATCHA_TIN, CAKE] };

function legacyItem(i: number, over: Partial<OrderItem>): OrderItem {
  return {
    id: `oi-${i}`,
    orderId: `ord-${i}`,
    menuItemId: MATCHA_LATTE.id,
    menuItemNameSnap: "Matcha Latte",
    priceSnap: 7,
    costSnap: 2.1,
    quantity: 1,
    status: "done",
    ...over,
  };
}

function legacyOrders(): Order[] {
  const lines: Array<Partial<OrderItem>> = [
    {}, // full price
    { quantity: 3 },
    { discountPct: 10 },
    { discountPct: 33.3, quantity: 2 },
    { discountPct: 50, menuItemId: CAKE.id, menuItemNameSnap: "Cheesecake", priceSnap: 8, costSnap: 1.4 },
    { discountPct: 100 }, // free
    { discountPct: 100, quantity: 2, menuItemId: MATCHA_TIN.id, menuItemNameSnap: "Matcha Tin", priceSnap: 12, costSnap: 5 },
    { discountPct: 0 },
    {
      isCombo: true,
      comboPastryId: CAKE.id,
      comboPastryNameSnap: "Cheesecake",
      priceSnap: 10,
      costSnap: 3.5,
      quantity: 2,
    },
    { isCombo: true, comboPastryId: CAKE.id, priceSnap: 10, costSnap: 3.5, discountPct: 100 },
    { isCombo: true, comboPastryId: CAKE.id, priceSnap: 10, costSnap: 3.5, discountPct: 20 },
  ];
  return lines.map((l, i) =>
    makeOrder({
      id: `ord-${i}`,
      orderNumber: i + 1,
      paymentMethod: (["cash", "venmo", "zelle"] as const)[i % 3],
      items: [legacyItem(i, l)],
    }),
  );
}

/** A frozen copy of the revenue / COGS math exactly as it was before this
 *  change. The new code must reproduce it for rows that existed before. */
function legacyTotals(orders: Order[], fixed: number) {
  let revenue = 0;
  let cogs = 0;
  for (const o of orders) {
    for (const it of o.items) {
      const f = 1 - Math.min(1, Math.max(0, (it.discountPct ?? 0) / 100));
      revenue += it.priceSnap * f * it.quantity;
      cogs += it.costSnap * it.quantity;
    }
  }
  return { revenue, cogs, profit: revenue - cogs - fixed };
}

/** What migration-order-item-prices.sql does to every existing row. */
function backfill(orders: Order[]): Order[] {
  return orders.map((o) => ({
    ...o,
    items: o.items.map((it) => ({
      ...it,
      listPrice: it.priceSnap,
      priceCharged: it.priceSnap * (1 - (it.discountPct ?? 0) / 100),
    })),
  }));
}

describe("existing events do not change", () => {
  const fixedCosts: FixedCost[] = [
    { id: "f1", name: "Booth", amount: 40, allocationMethod: "spread_evenly" },
  ];
  const orders = legacyOrders();
  const before = legacyTotals(orders, 40);

  it("old rows (no price columns) give the same revenue, COGS and profit through the new helper", () => {
    const t = computeEventTotals(SNAP, fixedCosts, orders);
    expect(t.revenuePaid).toBeCloseTo(before.revenue, 9);
    expect(t.ingredientCost).toBeCloseTo(before.cogs, 9);
    expect(t.profit).toBeCloseTo(before.profit, 9);
  });

  it("after the backfill (list_price / price_charged filled in) they are still identical", () => {
    const t = computeEventTotals(SNAP, fixedCosts, backfill(orders));
    expect(t.revenuePaid).toBeCloseTo(before.revenue, 9);
    expect(t.ingredientCost).toBeCloseTo(before.cogs, 9);
    expect(t.profit).toBeCloseTo(before.profit, 9);
    // Gross is unchanged too: list price is the old price_snap.
    const grossBefore = orders.reduce(
      (s, o) => s + o.items.reduce((a, it) => a + it.priceSnap * it.quantity, 0),
      0,
    );
    expect(t.revenueGross).toBeCloseTo(grossBefore, 9);
  });

  it("the per-item and combo-split views keep the same revenue and cost", () => {
    const plain = computeItemTotals(SNAP, backfill(orders));
    const legacyPlain = computeItemTotals(SNAP, orders);
    for (const row of plain) {
      const old = legacyPlain.find((r) => r.menuItemId === row.menuItemId)!;
      expect(row.revenuePaid).toBeCloseTo(old.revenuePaid, 9);
      expect(row.totalCost).toBeCloseTo(old.totalCost, 9);
      expect(row.qty).toBe(old.qty);
    }
    const split = expandCombosInByItem(plain, SNAP, backfill(orders));
    const splitOld = expandCombosInByItem(legacyPlain, SNAP, orders);
    expect(split.reduce((s, r) => s + r.revenuePaid, 0)).toBeCloseTo(
      splitOld.reduce((s, r) => s + r.revenuePaid, 0),
      9,
    );
    expect(split.reduce((s, r) => s + r.totalCost, 0)).toBeCloseTo(
      splitOld.reduce((s, r) => s + r.totalCost, 0),
      9,
    );
  });

  it("adding extra (tips and standalone entries) leaves revenue, COGS and profit untouched", () => {
    const withTips = backfill(orders).map((o, i) => ({
      ...o,
      tipAmount: i % 2 === 0 ? 1.5 : undefined,
    }));
    const extras: EventExtra[] = [
      { id: "x1", eventId: "evt-1", amount: 20, paymentMethod: "venmo", createdAt: T, updatedAt: T },
    ];
    const t = computeEventTotals(SNAP, fixedCosts, withTips);
    expect(t.revenuePaid).toBeCloseTo(before.revenue, 9);
    expect(t.ingredientCost).toBeCloseTo(before.cogs, 9);
    expect(t.profit).toBeCloseTo(before.profit, 9);
    const c = computeCollected(withTips, extras);
    expect(c.salesRevenue).toBeCloseTo(before.revenue, 9);
    expect(c.totalCollected).toBeCloseTo(before.revenue + c.extraTotal, 9);
  });

  it("existing orders default to 0 extra", () => {
    const c = computeCollected(orders, []);
    expect(c.extraTotal).toBe(0);
    expect(c.ordersWithExtra).toBe(0);
    expect(c.avgExtraPerOrder).toBeNull();
    expect(c.totalCollected).toBeCloseTo(c.salesRevenue, 9);
  });
});

describe("free vs discounted", () => {
  const item = (over: Partial<OrderItem>) => makeItem({ listPrice: 10, priceSnap: 10, ...over });

  it("free is derived from price_charged = 0, discounted from 0 < charged < list", () => {
    expect(priceKind(item({ priceCharged: 0 }))).toBe("free");
    expect(priceKind(item({ priceCharged: 4 }))).toBe("discounted");
    expect(priceKind(item({ priceCharged: 10 }))).toBe("paid");
    // Old rows fall back to discount_pct.
    expect(priceKind(makeItem({ discountPct: 100 }))).toBe("free");
    expect(priceKind(makeItem({ discountPct: 25 }))).toBe("discounted");
    expect(priceKind(makeItem({}))).toBe("paid");
    expect(chargedUnit(makeItem({ discountPct: 50 }))).toBe(3.5);
    expect(listUnit(makeItem({}))).toBe(7);
  });

  const orders = [
    makeOrder({
      id: "a",
      items: [
        item({ id: "1", quantity: 2, priceCharged: 10 }), // paid
        item({ id: "2", quantity: 3, priceCharged: 6, costSnap: 2 }), // discounted $4 each
        item({ id: "3", quantity: 2, priceCharged: 0, costSnap: 2, freeReason: "sample" }), // free
      ],
    }),
  ];

  it("Items sold counts paid and discounted, not free; free and discount lines are separate", () => {
    const t = computeEventTotals(SNAP, [], orders);
    expect(t.itemsSold).toBe(5);
    expect(t.freeItems).toBe(2);
    expect(t.freeRetailValue).toBe(20);
    expect(t.discountedItems).toBe(3);
    expect(t.discountTotal).toBe(12);
    // Revenue = sum of price_charged x qty; free adds $0.
    expect(t.revenuePaid).toBe(2 * 10 + 3 * 6);
  });

  it("COGS and cups still include the free items", () => {
    const t = computeEventTotals(SNAP, [], orders);
    expect(t.ingredientCost).toBe(2 * 2 + 3 * 2 + 2 * 2);
    expect(t.totalCups).toBe(7);
  });

  it("per-item rows expose paid vs free quantities (best seller uses qtyPaid)", () => {
    const rows = computeItemTotals(SNAP, [
      makeOrder({ items: [makeItem({ quantity: 9, priceCharged: 0, listPrice: 7 })] }),
      makeOrder({
        id: "o2",
        items: [
          makeItem({ id: "p", menuItemId: MATCHA_TIN.id, menuItemNameSnap: "Tin", priceSnap: 12, listPrice: 12, priceCharged: 12, quantity: 2 }),
        ],
      }),
    ]);
    const latte = rows.find((r) => r.menuItemId === MATCHA_LATTE.id)!;
    const tin = rows.find((r) => r.menuItemId === MATCHA_TIN.id)!;
    expect(latte.qty).toBe(9);
    expect(latte.qtyPaid).toBe(0);
    const best = [...rows].filter((r) => r.qtyPaid > 0).sort((a, b) => b.qtyPaid - a.qtyPaid)[0];
    expect(best.menuItemId).toBe(tin.menuItemId);
  });

  it("stamps list price, price charged and the free reason when an order line is built", () => {
    const free = deriveOrderItem(
      { menuItemId: MATCHA_LATTE.id, quantity: 1, discountPct: 100, freeReason: "staff" },
      "o",
      SNAP,
    );
    expect(free.listPrice).toBe(7);
    expect(free.priceCharged).toBe(0);
    expect(free.freeReason).toBe("staff");
    // A reason on a line that is not free is dropped, never kept as stale data.
    const half = deriveOrderItem(
      { menuItemId: MATCHA_LATTE.id, quantity: 1, discountPct: 50, freeReason: "staff" },
      "o",
      SNAP,
    );
    expect(half.priceCharged).toBe(3.5);
    expect(half.freeReason).toBeUndefined();
    const combo = deriveOrderItem(
      { menuItemId: MATCHA_LATTE.id, quantity: 1, isCombo: true, comboPastryId: CAKE.id },
      "o",
      SNAP,
    );
    expect(combo.listPrice).toBe(10);
    expect(combo.priceCharged).toBe(10);
  });

  it("changing a discount keeps price_charged in step and clears a stale reason", () => {
    const base = makeItem({ listPrice: 7, priceCharged: 0, discountPct: 100, freeReason: "sample" });
    const toHalf = normalizeItemPatch(base, { discountPct: 50 });
    expect(toHalf.priceCharged).toBe(3.5);
    expect(toHalf.freeReason).toBeUndefined();
    const toFree = normalizeItemPatch(makeItem({ listPrice: 7 }), { discountPct: 100 });
    expect(toFree.priceCharged).toBe(0);
    const cleared = normalizeItemPatch(base, { discountPct: undefined });
    expect(cleared.priceCharged).toBe(7);
  });
});

describe("extra money", () => {
  it("round up goes to the next whole dollar of what is owed", () => {
    expect(roundUpExtra(5.25)).toBe(0.75);
    expect(roundUpExtra(5.9)).toBeCloseTo(0.1, 9);
    expect(roundUpExtra(5)).toBe(0);
    expect(roundUpExtra(0)).toBe(0);
    expect(roundUpExtra(0.1 + 0.2)).toBeCloseTo(0.7, 9); // float noise
  });

  it("round up is calculated against the total owed, including checkout tax", () => {
    // $10.00 of items + $0.88 tax = $10.88 owed -> round up $0.12.
    expect(roundUpExtra(amountOwed(10, 0.88))).toBeCloseTo(0.12, 9);
    // The same items with no tax round to nothing.
    expect(roundUpExtra(amountOwed(10))).toBe(0);
    expect(extraAmount({ ...NO_EXTRA, mode: "round" }, amountOwed(10, 0.88))).toBeCloseTo(0.12, 9);
  });

  it("quick buttons resolve to dollars", () => {
    expect(extraAmount({ ...NO_EXTRA, mode: "none" }, 7)).toBe(0);
    expect(extraAmount({ ...NO_EXTRA, mode: "plus1" }, 7)).toBe(1);
    expect(extraAmount({ ...NO_EXTRA, mode: "plus2" }, 7)).toBe(2);
    expect(extraAmount({ mode: "custom", custom: 3.456, method: "" }, 7)).toBe(3.46);
    expect(extraAmount({ mode: "custom", custom: -4, method: "" }, 7)).toBe(0);
  });

  const cart: CartLine[] = [{ cid: "c", menuItemId: MATCHA_LATTE.id, quantity: 1 }];
  const ctx = { orderId: "o", orderNumber: 1, submittedAt: T, event: EVENT };

  it("the order stores the extra, and its method only when it differs from the order's", () => {
    const base = { cart, snapshot: SNAP, customerName: "", notes: "" };
    const same = buildOrder(
      { ...base, paymentMethod: "venmo", tipAmount: 1, tipPaymentMethod: "venmo" },
      ctx,
    );
    expect(same.tipAmount).toBe(1);
    expect(same.tipPaymentMethod).toBeUndefined();
    const other = buildOrder(
      { ...base, paymentMethod: "zelle", tipAmount: 1, tipPaymentMethod: "cash" },
      ctx,
    );
    expect(other.tipPaymentMethod).toBe("cash");
    const none = buildOrder({ ...base, paymentMethod: "cash", tipAmount: 0, tipPaymentMethod: "venmo" }, ctx);
    expect(none.tipAmount).toBeUndefined();
    expect(none.tipPaymentMethod).toBeUndefined();
    // Extra never touches the item prices or the order's sales.
    expect(same.items[0].priceCharged).toBe(7);
  });

  it("event summary: totals, average, standalone entries and the per-method breakdown", () => {
    const orders = [
      makeOrder({ id: "a", paymentMethod: "venmo", tipAmount: 1, items: [makeItem({ id: "1", priceCharged: 7, listPrice: 7 })] }),
      makeOrder({ id: "b", orderNumber: 2, paymentMethod: "zelle", tipAmount: 2, tipPaymentMethod: "cash", items: [makeItem({ id: "2", orderId: "b", priceCharged: 7, listPrice: 7 })] }),
      makeOrder({ id: "c", orderNumber: 3, paymentMethod: "cash", items: [makeItem({ id: "3", orderId: "c", priceCharged: 7, listPrice: 7 })] }),
    ];
    const extras: EventExtra[] = [
      { id: "x1", eventId: "evt-1", amount: 5, paymentMethod: "venmo", createdAt: T, updatedAt: T },
    ];
    const c = computeCollected(orders, extras);
    expect(c.salesRevenue).toBe(21);
    expect(c.orderExtra).toBe(3);
    expect(c.ordersWithExtra).toBe(2);
    expect(c.avgExtraPerOrder).toBe(1.5);
    expect(c.standaloneExtra).toBe(5);
    expect(c.standaloneCount).toBe(1);
    expect(c.extraTotal).toBe(8);
    expect(c.totalCollected).toBe(29);
    const by = Object.fromEntries(c.byMethod.map((b) => [b.method, b]));
    // Venmo account: its sale + its order extra + the standalone Venmo.
    expect(by.venmo.total).toBe(7 + 1 + 5);
    // Zelle holds only the sale; the extra on that order was paid in cash.
    expect(by.zelle.total).toBe(7);
    expect(by.cash.total).toBe(7 + 2);
    expect(c.byMethod.reduce((s, b) => s + b.total, 0)).toBe(c.totalCollected);
  });
});

describe("database columns", () => {
  it("writes the new columns on insert", () => {
    const o = makeOrder({ tipAmount: 2, tipPaymentMethod: "cash" });
    const row = toOrderInsert("ws", o);
    expect(row.tip_amount).toBe(2);
    expect(row.tip_payment_method).toBe("cash");
    expect(toOrderInsert("ws", makeOrder()).tip_amount).toBe(0);
    expect("tip_amount" in toOrderInsert("ws", o, { includeTip: false })).toBe(false);
    const it = toOrderItemInsert("ws", makeItem({ discountPct: 50, freeReason: undefined }));
    expect(it.list_price).toBe(7);
    expect(it.price_charged).toBe(3.5);
  });

  it("an order patch only carries the extra when the extra is in the patch", () => {
    expect(toOrderPatch({ customerName: "A" })).toEqual({ customer_name: "A" });
    expect(toOrderPatch({ tipAmount: 2 }).tip_amount).toBe(2);
    expect(toOrderPatch({ tipAmount: undefined }).tip_amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A missing column is never swallowed
// ---------------------------------------------------------------------------

type R = { error: unknown; data?: unknown };
const missing = (col: string): R => ({
  error: { code: "PGRST204", message: `Could not find the '${col}' column of 'orders' in the schema cache` },
});

function fakeDb(handlers: {
  rpc?: () => R;
  ordersInsert?: (row: Record<string, unknown>) => R;
  itemsInsert?: (rows: Array<Record<string, unknown>>) => R;
  update?: (table: string, patch: Record<string, unknown>) => R;
}) {
  const calls: Array<{ op: string; table?: string; payload?: unknown }> = [];
  const client = {
    rpc: () => Promise.resolve(handlers.rpc ? handlers.rpc() : { error: null, data: { order_number: 1 } }),
    from: (table: string) => ({
      insert: (payload: unknown) => {
        calls.push({ op: "insert", table, payload });
        const r =
          table === "orders"
            ? handlers.ordersInsert?.(payload as Record<string, unknown>)
            : handlers.itemsInsert?.(payload as Array<Record<string, unknown>>);
        return Promise.resolve(r ?? { error: null });
      },
      update: (payload: Record<string, unknown>) => {
        calls.push({ op: "update", table, payload });
        const result = handlers.update?.(table, payload) ?? { error: null };
        const chain = {
          eq: () => chain,
          then: (res: (v: R) => unknown) => Promise.resolve(result).then(res),
        };
        return chain;
      },
      delete: () => {
        const chain = { eq: () => chain, then: (res: (v: R) => unknown) => Promise.resolve({ error: null }).then(res) };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

async function run<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe("a missing column is reported, never dropped silently", () => {
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

  const tipOrder = makeOrder({ tipAmount: 2, items: [makeItem({ priceCharged: 7, listPrice: 7 })] });

  it("old submit_order() + extra: the extra is applied with an update, nothing lost", async () => {
    const { client, calls } = fakeDb({ rpc: () => ({ error: null, data: { order_number: 1 } }) });
    await run(writer(client, "ws").submitOrder(tipOrder));
    const upd = calls.find((c) => c.op === "update" && c.table === "orders");
    expect((upd?.payload as Record<string, unknown>).tip_amount).toBe(2);
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("old submit_order() + extra + no tip column: visible error", async () => {
    const { client } = fakeDb({
      rpc: () => ({ error: null, data: { order_number: 1 } }),
      update: () => missing("tip_amount"),
    });
    const res = await run(writer(client, "ws").submitOrder(tipOrder));
    expect("finalOrderNumber" in res).toBe(true); // the drink order itself still goes through
    const errs = getSaveErrors();
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/extra of \$2\.00/);
    expect(errs[0].message).toMatch(/migration-order-tips-and-extras\.sql/);
  });

  it("new submit_order() (features: 2) needs no follow-up update", async () => {
    const { client, calls } = fakeDb({ rpc: () => ({ error: null, data: { order_number: 1, features: 2 } }) });
    await run(writer(client, "ws").submitOrder(tipOrder));
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("no rpc + no tip column + an extra: order saved without it, error shown", async () => {
    const { client, calls } = fakeDb({
      rpc: () => ({ error: { code: "PGRST202", message: "not found" } }),
      ordersInsert: (row) => ("tip_amount" in row ? missing("tip_amount") : { error: null }),
    });
    const res = await run(writer(client, "ws").submitOrder(tipOrder));
    expect(res).toEqual({ finalOrderNumber: 1 });
    const inserts = calls.filter((c) => c.op === "insert" && c.table === "orders");
    expect(inserts.length).toBeGreaterThan(1);
    expect("tip_amount" in (inserts.at(-1)!.payload as object)).toBe(false);
    expect(getSaveErrors().map((e) => e.message).join(" ")).toMatch(/extra of \$2\.00/);
  });

  it("no tip column but NO extra on the order: nothing real was lost, so no error", async () => {
    const { client } = fakeDb({
      rpc: () => ({ error: { code: "PGRST202", message: "not found" } }),
      ordersInsert: (row) => ("tip_amount" in row ? missing("tip_amount") : { error: null }),
    });
    const res = await run(writer(client, "ws").submitOrder(makeOrder()));
    expect(res).toEqual({ finalOrderNumber: 1 });
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("no free_reason column + a free reason: visible error; price columns missing alone: silent", async () => {
    const freeOrder = makeOrder({
      items: [makeItem({ priceCharged: 0, listPrice: 7, discountPct: 100, freeReason: "giveaway" })],
    });
    const a = fakeDb({
      rpc: () => ({ error: { code: "PGRST202", message: "not found" } }),
      itemsInsert: (rows) => ("free_reason" in rows[0] ? missing("free_reason") : { error: null }),
    });
    await run(writer(a.client, "ws").submitOrder(freeOrder));
    expect(getSaveErrors().map((e) => e.message).join(" ")).toMatch(/free reason could not be saved/);

    clearSaveErrors();
    const noReason = makeOrder({ items: [makeItem({ priceCharged: 7, listPrice: 7 })] });
    const b = fakeDb({
      rpc: () => ({ error: { code: "PGRST202", message: "not found" } }),
      itemsInsert: (rows) =>
        "price_charged" in rows[0] ? missing("price_charged") : { error: null },
    });
    await run(writer(b.client, "ws").submitOrder(noReason));
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("editing the extra on a past order: error shown, but the name edit still saves", async () => {
    const { client, calls } = fakeDb({
      update: (_t, patch) => ("tip_amount" in patch ? missing("tip_amount") : { error: null }),
    });
    await run(writer(client, "ws").updateOrder("ord-1", { customerName: "Sam B", tipAmount: 3 }));
    const updates = calls.filter((c) => c.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual({ customer_name: "Sam B" });
    expect(getSaveErrors()).toHaveLength(1);
  });

  it("standalone extra with no table: visible error", async () => {
    const { client } = fakeDb({
      itemsInsert: () => ({ error: { code: "PGRST205", message: "Could not find the table 'public.event_extras'" } }),
    });
    await run(
      writer(client, "ws").addEventExtra({
        id: "x",
        eventId: "evt-1",
        amount: 5,
        paymentMethod: "venmo",
        createdAt: T,
        updatedAt: T,
      }),
    );
    expect(getSaveErrors().map((e) => e.message).join(" ")).toMatch(/event_extras table does not exist/);
  });
});

// keep imports honest
void WHOLE;
