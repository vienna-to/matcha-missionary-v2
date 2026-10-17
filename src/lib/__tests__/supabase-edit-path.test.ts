import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import { writer } from "@/lib/supabase/writer";
import type { AppState, Order } from "@/lib/types";

/**
 * Supabase-mode edit path. In store.tsx the Supabase dispatch applies the SAME
 * reducer locally (`baseDispatch(a)`), then for REPLACE_ORDER_ITEMS reads the
 * resulting order back from state and calls `writer.replaceOrderItems(orderId,
 * order.items)`. So the fix in the reducer reaches the database only if the
 * writer sends the stamped fields through unchanged. This test runs exactly that
 * pair (reducer, then writer) against a recording fake client and checks the
 * rows that would be inserted.
 */
type Row = Record<string, unknown>;

function recorder() {
  const inserts: Row[][] = [];
  const deletes: string[] = [];
  const client = {
    from: (table: string) => ({
      insert: (rows: Row[] | Row) => {
        if (table === "order_items") inserts.push(Array.isArray(rows) ? rows : [rows]);
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const chain = {
          eq: (col: string, val: string) => {
            if (table === "order_items" && col === "order_id") deletes.push(val);
            return chain;
          },
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts, deletes };
}

function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "E", date: "2026-10-16", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  return { s, ev: s.events.find((e) => e.name === "E")! };
}

function submit(state: AppState, eventId: string, items: Order["items"]): AppState {
  return reducer(state, {
    type: "SUBMIT_ORDER",
    order: {
      id: "ord_sb", eventId, orderNumber: 1, customerName: "T", items,
      submittedAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
      paymentStatus: "paid", paymentMethod: "cash", status: "pending",
    },
  });
}

describe("Supabase mode: edit order writes sale-time price and cost to order_items", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("a price change after the event does not leak into the rows written on edit", async () => {
    const { s, ev } = setup();
    let st = reducer(s, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { price: 8 } });
    const live = { id: "live", menuItems: st.menuItems, ingredients: st.ingredients, createdAt: "" };
    const line = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "ord_sb", live, 16);
    st = submit(st, ev.id, [line]);
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_sb",
      items: [{ sourceItemId: line.id, menuItemId: "mi_classic", quantity: 2 }],
    });
    const next = st.orders.find((o) => o.id === "ord_sb")!;

    const { client, inserts, deletes } = recorder();
    await writer(client, "ws").replaceOrderItems(next.id, next.items);
    expect(deletes).toEqual(["ord_sb"]);
    const rows = inserts.flat();
    expect(rows).toHaveLength(1);
    expect(rows[0].price_snap).toBe(8);
    expect(rows[0].list_price).toBe(8);
    expect(rows[0].price_charged).toBe(8);
    expect(rows[0].cost_snap as number).toBeCloseTo(line.costSnap, 10);
    expect(rows[0].quantity).toBe(2);
  });

  it("an item added after the event was created is written with its name and price, not 'Unknown item' / 0", async () => {
    const { s, ev } = setup();
    let st = reducer(s, {
      type: "ADD_MENU_ITEM",
      item: { name: "Pop Special", category: "other", price: 5, size: "16oz", active: true, ingredientLines: [], allowedMilkIds: [], allowedCreamIds: [] },
    });
    const added = st.menuItems.find((m) => m.name === "Pop Special")!;
    const live = { id: "live", menuItems: st.menuItems, ingredients: st.ingredients, createdAt: "" };
    const line = deriveOrderItem({ menuItemId: added.id, quantity: 1 }, "ord_sb", live, 16);
    st = submit(st, ev.id, [line]);
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_sb",
      items: [{ sourceItemId: line.id, menuItemId: added.id, quantity: 1, specialRequests: "extra cold" }],
    });
    const next = st.orders.find((o) => o.id === "ord_sb")!;
    const { client, inserts } = recorder();
    await writer(client, "ws").replaceOrderItems(next.id, next.items);
    const row = inserts.flat()[0];
    expect(row.menu_item_name_snap).toBe("Pop Special");
    expect(row.price_snap).toBe(5);
    expect(row.menu_item_id).toBe(added.id);
    expect(row.special_requests).toBe("extra cold");
  });
});
