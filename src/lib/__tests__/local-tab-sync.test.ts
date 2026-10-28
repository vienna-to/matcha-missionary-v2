import { describe, expect, it } from "vitest";
import { mergeLocalOrders, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Order } from "@/lib/types";

/**
 * Local adapter (no Supabase): tabs sync by broadcasting their whole state. Two tabs submitting at the
 * same moment used to overwrite each other (REPLACE = last writer wins): one order vanished and both
 * could take the same number. A tab now keeps the orders it submitted that the other tab's state does
 * not hold yet, and the later-submitted of two clashing numbers moves to the next free one.
 */
const base = (): { s: AppState; eventId: string } => {
  let s = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "Race", date: "2026-10-27", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  return { s, eventId: s.events.find((e) => e.name === "Race")!.id };
};

const order = (eventId: string, id: string, n: number, at: string): Order => ({
  id, eventId, orderNumber: n, customerName: id, items: [], submittedAt: at, updatedAt: at,
  paymentStatus: "paid", paymentMethod: "cash", status: "pending",
});

/** What a tab holds after submitting its own order, and what the other tab then broadcasts. */
function twoTabs() {
  const { s, eventId } = base();
  const a = reducer(s, { type: "SUBMIT_ORDER", order: order(eventId, "ord_A", 1, "2026-10-27T12:00:00.001Z") });
  const b = reducer(s, { type: "SUBMIT_ORDER", order: order(eventId, "ord_B", 1, "2026-10-27T12:00:00.002Z") });
  return { a, b, eventId };
}

const race = (st: AppState, eventId: string) =>
  st.orders.filter((o) => o.eventId === eventId).map((o) => [o.id, o.orderNumber]).sort();

describe("two tabs submit at the same moment (local adapter)", () => {
  it("the old behaviour lost an order: REPLACE with the other tab's state", () => {
    const { a, b, eventId } = twoTabs();
    expect(race(reducer(a, { type: "REPLACE", state: b }), eventId)).toEqual([["ord_B", 1]]); // ord_A gone
  });

  it("each tab keeps its own order and ends with both, with different numbers", () => {
    const { a, b, eventId } = twoTabs();
    const atA = reducer(a, { type: "LOCAL_SYNC", state: b, keepIds: ["ord_A"] });
    const atB = reducer(b, { type: "LOCAL_SYNC", state: a, keepIds: ["ord_B"] });
    // A submitted first, so A keeps #1; B (later) takes #2 on its own tab
    expect(race(atB, eventId)).toEqual([["ord_A", 1], ["ord_B", 2]]);
    // A still sees B's order with the number B had when it broadcast (#1) until B's merged state arrives...
    expect(atA.orders.filter((o) => o.eventId === eventId)).toHaveLength(2);
    // ...which is what B broadcasts after merging: A takes it as is, and both tabs now agree
    const settledA = reducer(atA, { type: "LOCAL_SYNC", state: atB, keepIds: [] });
    expect(race(settledA, eventId)).toEqual(race(atB, eventId));
  });

  it("the later order gets the bump whichever tab does the comparing", () => {
    const { a, b, eventId } = twoTabs();
    const atA = reducer(a, { type: "LOCAL_SYNC", state: b, keepIds: ["ord_A"] });
    expect(atA.orders.find((o) => o.id === "ord_A")!.orderNumber).toBe(1); // earlier: unchanged
    const atB = reducer(b, { type: "LOCAL_SYNC", state: a, keepIds: ["ord_B"] });
    expect(atB.orders.find((o) => o.id === "ord_B")!.orderNumber).toBe(2); // later: bumped
    void eventId;
  });

  it("an order the other tab already holds is not duplicated or renumbered", () => {
    const { a, eventId } = twoTabs();
    const out = mergeLocalOrders(a.orders, a.orders, new Set(["ord_A"]));
    expect(out.filter((o) => o.id === "ord_A")).toHaveLength(1);
    expect(out.find((o) => o.id === "ord_A")!.orderNumber).toBe(1);
    void eventId;
  });

  it("with nothing pending it is the other tab's state exactly (no resurrection of deleted orders)", () => {
    const { a, b } = twoTabs();
    const withoutA = reducer(b, { type: "DELETE_ORDER", id: "ord_B" });
    const out = reducer(a, { type: "LOCAL_SYNC", state: withoutA, keepIds: [] });
    expect(out.orders).toEqual(withoutA.orders);
  });

  it("a kept order that clashes with an OLDER order takes the next number", () => {
    const { s, eventId } = base();
    const old = reducer(s, { type: "SUBMIT_ORDER", order: order(eventId, "ord_old", 1, "2026-10-27T11:00:00.000Z") });
    const mine = reducer(s, { type: "SUBMIT_ORDER", order: order(eventId, "ord_mine", 1, "2026-10-27T12:00:00.000Z") });
    const out = reducer(mine, { type: "LOCAL_SYNC", state: old, keepIds: ["ord_mine"] });
    expect(race(out, eventId)).toEqual([["ord_mine", 2], ["ord_old", 1]]);
  });

  it("many pending orders keep unique numbers", () => {
    const { s, eventId } = base();
    let local = s;
    for (let i = 0; i < 3; i++) local = reducer(local, { type: "SUBMIT_ORDER", order: order(eventId, `ord_m${i}`, i + 1, `2026-10-27T12:00:0${i}.000Z`) });
    const incoming = reducer(s, { type: "SUBMIT_ORDER", order: order(eventId, "ord_x", 1, "2026-10-27T11:59:00.000Z") });
    const out = reducer(local, { type: "LOCAL_SYNC", state: incoming, keepIds: ["ord_m0", "ord_m1", "ord_m2"] });
    const numbers = out.orders.filter((o) => o.eventId === eventId).map((o) => o.orderNumber).sort();
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
