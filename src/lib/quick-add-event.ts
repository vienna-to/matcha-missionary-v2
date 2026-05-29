import { computeItemCost } from "./calc";
import { newId } from "./id";
import type {
  AppState,
  Event,
  MenuSnapshot,
  Order,
  OrderItem,
  PaymentMethod,
} from "./types";

/**
 * Build a complete (event, snapshot, orders) tuple for a "quick-add past event"
 * — given only the high-level info the user enters (name, date, window,
 * quantity per menu item), this synthesizes one order per cup sold,
 * distributing submission timestamps across the event window so the
 * time-of-day chart looks plausible.
 *
 * Costs are stamped from the current master ingredient prices via the same
 * `computeItemCost` used for live orders, so margin/profit calculations land
 * in the same shape Event Summary expects.
 */
export function buildQuickAddEvent({
  state,
  name,
  date,
  startTime,
  endTime,
  notes,
  donationPct,
  itemQuantities,
  paymentMethod = "cash",
}: {
  state: AppState;
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  notes?: string;
  donationPct?: number;
  itemQuantities: Record<string, number>;
  paymentMethod?: PaymentMethod;
}): { event: Event; snapshot: MenuSnapshot; orders: Order[] } {
  const now = new Date().toISOString();

  // Snapshot the entire current master menu (active + archived) — past events
  // may include sales of items that have since been retired, so we have to
  // keep them referenceable for the order_items in this event.
  const snapshot: MenuSnapshot = {
    id: newId(),
    menuItems: state.menuItems.map((m) => ({
      ...m,
      ingredientLines: m.ingredientLines.map((l) => ({ ...l })),
      allowedMilkIds: [...m.allowedMilkIds],
      allowedCreamIds: [...m.allowedCreamIds],
    })),
    ingredients: state.ingredients.map((i) => ({ ...i })),
    createdAt: now,
  };

  const event: Event = {
    id: newId(),
    name,
    date,
    startTime,
    endTime,
    targetRevenue: undefined,
    donationPct:
      donationPct !== undefined && donationPct > 0 && donationPct <= 100
        ? donationPct
        : undefined,
    menuSnapshotId: snapshot.id,
    fixedCosts: [],
    isActive: false, // past event — don't steal active from current live event
    kind: "past",
    notes: notes && notes.trim().length > 0 ? notes.trim() : undefined,
    createdAt: now,
    updatedAt: now,
  };

  // Expand quantities into a flat queue of menu-item-ids (one per cup).
  const cupQueue: string[] = [];
  for (const [miId, qty] of Object.entries(itemQuantities)) {
    const n = Math.max(0, Math.floor(qty));
    for (let i = 0; i < n; i++) cupQueue.push(miId);
  }

  if (cupQueue.length === 0) {
    return { event, snapshot, orders: [] };
  }

  // Shuffle so identical drinks aren't grouped together in the timeline.
  for (let i = cupQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cupQueue[i], cupQueue[j]] = [cupQueue[j], cupQueue[i]];
  }

  // Build the start/end timestamps from the event-day midnight local time.
  const startMs = makeDayTime(date, startTime, 11, 0).getTime();
  const endMs = makeDayTime(date, endTime, 16, 0).getTime();
  const window = Math.max(60_000, endMs - startMs); // at least 1 min

  const itemById = new Map(snapshot.menuItems.map((m) => [m.id, m]));

  const orders: Order[] = cupQueue.map((miId, idx) => {
    const mi = itemById.get(miId);
    if (!mi) throw new Error(`Quick-add: unknown menu item id ${miId}`);
    const cost = computeItemCost(mi, snapshot.ingredients, {});
    const t =
      cupQueue.length === 1
        ? startMs + window / 2
        : startMs + (window * idx) / (cupQueue.length - 1);
    const submittedAt = new Date(t).toISOString();
    const orderId = newId();
    const item: OrderItem = {
      id: newId(),
      orderId,
      menuItemId: miId,
      menuItemNameSnap: mi.name,
      priceSnap: mi.price,
      costSnap: cost,
      quantity: 1,
      status: "done",
    };
    return {
      id: orderId,
      eventId: event.id,
      orderNumber: idx + 1,
      customerName: `#${idx + 1}`,
      items: [item],
      paymentStatus: "paid",
      paymentMethod,
      status: "completed",
      submittedAt,
      doneAt: submittedAt,
      updatedAt: submittedAt,
    };
  });

  return { event, snapshot, orders };
}

function makeDayTime(date: string, hhmm: string, fallbackH: number, fallbackM: number): Date {
  const [hStr, mStr] = (hhmm || "").split(":");
  const h = Number.isFinite(Number(hStr)) ? Number(hStr) : fallbackH;
  const m = Number.isFinite(Number(mStr)) ? Number(mStr) : fallbackM;
  // Local time on the event date — what the user typed in the picker.
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h, m, 0, 0);
}
