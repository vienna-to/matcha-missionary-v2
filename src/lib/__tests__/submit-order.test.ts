import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writer } from "@/lib/supabase/writer";
import { makeItem, makeOrder } from "./fixtures";

type Result = { error: unknown; data?: unknown };

/** Minimal Supabase stand-in that records the order of writes. */
function fakeSupabase(opts: { rpc?: () => Result; itemsInsert?: (rows: Array<Record<string, unknown>>) => Result }) {
  const log: string[] = [];
  const payloads: Record<string, unknown> = {};
  const client = {
    rpc: (name: string, args: unknown) => {
      log.push(`rpc:${name}`);
      payloads.rpc = args;
      return Promise.resolve(opts.rpc ? opts.rpc() : { error: null, data: { order_number: 1 } });
    },
    from: (table: string) => ({
      insert: (rows: unknown) => {
        log.push(`${table}.insert`);
        payloads[`${table}.insert`] = rows;
        const r =
          table === "order_items"
            ? opts.itemsInsert?.(rows as Array<Record<string, unknown>>)
            : undefined;
        return Promise.resolve(r ?? { error: null });
      },
      delete: () => {
        const chain = {
          eq: () => chain,
          then: (res: (v: Result) => unknown) => {
            log.push(`${table}.delete`);
            return Promise.resolve({ error: null }).then(res);
          },
        };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, log, payloads };
}

const order = makeOrder({
  items: [makeItem({ milkNameSnap: "Whole milk", creamNameSnap: "no cream" })],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function run<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe("submitOrder", () => {
  it("writes the order and its items in ONE atomic rpc call", async () => {
    const { client, log, payloads } = fakeSupabase({
      rpc: () => ({ error: null, data: { order_number: 7 } }),
    });
    const res = await run(writer(client, "ws").submitOrder(order));
    expect(res).toEqual({ finalOrderNumber: 7 });
    // No separate orders insert, so nothing can broadcast an item-less order.
    expect(log).toEqual(["rpc:submit_order"]);
    const args = payloads.rpc as { p_items: Array<Record<string, unknown>> };
    expect(args.p_items[0].milk_name_snap).toBe("Whole milk");
    expect(args.p_items[0].menu_item_name_snap).toBe("Matcha Latte");
  });

  it("retries the rpc on a transient failure (safe: it is idempotent)", async () => {
    let n = 0;
    const { client, log } = fakeSupabase({
      rpc: () =>
        ++n < 3
          ? { error: { code: "08006", message: "network" } }
          : { error: null, data: { order_number: 1 } },
    });
    const res = await run(writer(client, "ws").submitOrder(order));
    expect(res).toEqual({ finalOrderNumber: 1 });
    expect(log.filter((l) => l === "rpc:submit_order").length).toBe(3);
    expect(log).not.toContain("orders.insert");
  });

  it("reports failure (instead of dropping silently) when the rpc keeps failing", async () => {
    const { client } = fakeSupabase({
      rpc: () => ({ error: { code: "08006", message: "network" } }),
    });
    const res = await run(writer(client, "ws").submitOrder(order));
    expect(res).toEqual({ error: "order submit failed" });
  });

  it("falls back to the two-step write if the migration has not been run", async () => {
    // Un-migrated DB: no rpc, and order_items has no *_name_snap columns.
    const { client, log, payloads } = fakeSupabase({
      rpc: () => ({ error: { code: "PGRST202", message: "not found" } }),
      itemsInsert: (rows) =>
        "milk_name_snap" in rows[0]
          ? { error: { code: "PGRST204", message: "Could not find the 'milk_name_snap' column" } }
          : { error: null },
    });
    const res = await run(writer(client, "ws").submitOrder(order));
    expect(res).toEqual({ finalOrderNumber: 1 });
    expect(log[0]).toBe("rpc:submit_order");
    expect(log[1]).toBe("orders.insert");
    expect(log.filter((l) => l === "order_items.insert").length).toBeGreaterThan(1);
    // The accepted insert omitted the new columns.
    const rows = payloads["order_items.insert"] as Array<Record<string, unknown>>;
    expect("milk_name_snap" in rows[0]).toBe(false);
  });

  it("legacy path: the order exists BEFORE its items (the window that blanked cards) and is rolled back on failure", async () => {
    const { client, log } = fakeSupabase({
      rpc: () => ({ error: { code: "PGRST202", message: "not found" } }),
      itemsInsert: () => ({ error: { code: "08006", message: "boom" } }),
    });
    const res = await run(writer(client, "ws").submitOrder(order));
    expect(res).toEqual({ error: "items insert failed; parent rolled back" });
    const parent = log.indexOf("orders.insert");
    const items = log.indexOf("order_items.insert");
    expect(parent).toBeGreaterThan(-1);
    expect(items).toBeGreaterThan(parent); // parent committed first = visible without items
    expect(log).toContain("orders.delete");
  });
});
