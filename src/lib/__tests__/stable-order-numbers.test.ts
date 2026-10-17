import { describe, expect, it } from "vitest";
import { nextOrderNumber, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Order } from "@/lib/types";

function withOrders(n: number): { s: AppState; eventId: string } {
  let s = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "E", date: "2026-10-16", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  const eventId = s.events.find((e) => e.name === "E")!.id;
  for (let i = 1; i <= n; i++) {
    const o: Order = {
      id: `qa_${i}`, eventId, orderNumber: i, customerName: `C${i}`, items: [],
      submittedAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
      paymentStatus: "paid", paymentMethod: "cash", status: "pending",
    };
    s = reducer(s, { type: "SUBMIT_ORDER", order: o });
  }
  return { s, eventId };
}

describe("deleting an order keeps the other order numbers", () => {
  it("removing #2 of 4 leaves 1, 3, 4", () => {
    const { s, eventId } = withOrders(4);
    const next = reducer(s, { type: "DELETE_ORDER", id: "qa_2" });
    const nums = next.orders.filter((o) => o.eventId === eventId).map((o) => o.orderNumber).sort();
    expect(nums).toEqual([1, 3, 4]);
    expect(next.orders.find((o) => o.id === "qa_3")!.orderNumber).toBe(3);
  });

  it("new orders continue after the highest remaining number, never colliding", () => {
    const { s, eventId } = withOrders(4);
    const next = reducer(s, { type: "DELETE_ORDER", id: "qa_2" });
    expect(nextOrderNumber(next, eventId)).toBe(5);
  });

  it("orders in other events are untouched", () => {
    const { s } = withOrders(2);
    const seedOrder = s.orders.find((o) => !o.id.startsWith("qa_"))!;
    const next = reducer(s, { type: "DELETE_ORDER", id: "qa_1" });
    expect(next.orders.find((o) => o.id === seedOrder.id)!.orderNumber).toBe(seedOrder.orderNumber);
  });
});
