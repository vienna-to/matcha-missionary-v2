import type { AppState, Order } from "./types";

/** Escape one CSV field per RFC 4180 (quotes doubled, whole thing wrapped
 *  if it contains delimiters, quotes, or line breaks). */
function csvField(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

function toCsv(rows: unknown[][]): string {
  return rows.map(csvRow).join("\r\n");
}

/** Ratio of paid revenue for a single order item, discount + combo aware.
 *  Combos are split proportionally so combo drink revenue and combo pastry
 *  revenue add up to COMBO_PRICE * quantity. */
type ItemLine = {
  orderId: string;
  orderNumber: number;
  eventId: string;
  submittedAt: string;
  customerName: string;
  paymentMethod: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineRevenue: number;
  isCombo: boolean;
};

function orderToLines(order: Order): ItemLine[] {
  const out: ItemLine[] = [];
  const pm = order.paymentMethod ?? "";
  for (const it of order.items) {
    const factor = 1 - Math.min(1, Math.max(0, (it.discountPct ?? 0) / 100));
    const lineRevenue = it.priceSnap * factor * it.quantity;
    out.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      eventId: order.eventId,
      submittedAt: order.submittedAt,
      customerName: order.customerName,
      paymentMethod: pm,
      menuItemName: it.menuItemNameSnap,
      quantity: it.quantity,
      unitPrice: it.priceSnap,
      discountPct: it.discountPct ?? 0,
      lineRevenue,
      isCombo: Boolean(it.isCombo),
    });
    // Combos also snapshot a pastry; the pastry share of the bundle price is
    // recorded separately with $0 revenue attributed here (revenue lives on
    // the drink row). Kept in the export as a marker so the pastry count
    // matches the physical items served.
    if (it.isCombo && it.comboPastryNameSnap) {
      out.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        eventId: order.eventId,
        submittedAt: order.submittedAt,
        customerName: order.customerName,
        paymentMethod: pm,
        menuItemName: `${it.comboPastryNameSnap} (combo)`,
        quantity: it.quantity,
        unitPrice: 0,
        discountPct: 0,
        lineRevenue: 0,
        isCombo: true,
      });
    }
  }
  return out;
}

/**
 * Full-history CSV: every itemized sale across the whole workspace, plus a
 * second sheet-style section listing every event and expense. Single .csv
 * file with clearly labeled sections so a human (or an accountant) can
 * paste it into Excel/Sheets and eyeball each block.
 */
export function buildFullHistoryCsv(state: AppState): string {
  const eventById = new Map(state.events.map((e) => [e.id, e]));

  const rows: unknown[][] = [];

  rows.push(["EVENTS"]);
  rows.push([
    "Event name",
    "Date",
    "City",
    "Start",
    "End",
    "Kind",
    "Event type",
    "Admission charged",
    "Contract payout",
    "Donation %",
    "Cup size (oz)",
    "Client",
    "Notes",
  ]);
  const sortedEvents = [...state.events].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sortedEvents) {
    rows.push([
      e.name,
      e.date,
      e.city ?? "",
      e.startTime,
      e.endTime,
      e.kind ?? "live",
      e.eventType ?? "standard",
      e.admissionCharged === true ? "yes" : e.admissionCharged === false ? "no" : "",
      e.contractPayout ?? "",
      e.donationPct ?? "",
      e.cupSizeOz ?? "",
      e.clientName ?? "",
      e.notes ?? "",
    ]);
  }

  rows.push([]);
  rows.push(["ITEMIZED SALES"]);
  rows.push([
    "Event name",
    "Event date",
    "City",
    "Admission charged",
    "Order #",
    "Customer",
    "Submitted at",
    "Payment method",
    "Item",
    "Quantity",
    "Unit price",
    "Discount %",
    "Line revenue",
    "Combo",
  ]);
  const orders = [...state.orders].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  for (const o of orders) {
    const evt = eventById.get(o.eventId);
    for (const line of orderToLines(o)) {
      rows.push([
        evt?.name ?? "",
        evt?.date ?? "",
        evt?.city ?? "",
        evt?.admissionCharged === true
          ? "yes"
          : evt?.admissionCharged === false
            ? "no"
            : "",
        line.orderNumber,
        line.customerName,
        line.submittedAt,
        line.paymentMethod,
        line.menuItemName,
        line.quantity,
        line.unitPrice.toFixed(2),
        line.discountPct,
        line.lineRevenue.toFixed(2),
        line.isCombo ? "yes" : "",
      ]);
    }
  }

  rows.push([]);
  rows.push(["EXPENSES (INVENTORY / SUPPLIES)"]);
  rows.push(["Name", "Date", "Amount", "Archived", "Notes"]);
  const purchases = [...state.inventoryPurchases].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  for (const p of purchases) {
    rows.push([
      p.name,
      p.date,
      p.amount.toFixed(2),
      p.archived ? "yes" : "no",
      p.notes ?? "",
    ]);
  }

  return toCsv(rows);
}

// ---------------- Quarterly report ----------------

export type QuarterKey = 1 | 2 | 3 | 4;

export function quarterOf(dateIso: string): QuarterKey {
  // dateIso is YYYY-MM-DD; the month segment is what matters.
  const m = Number(dateIso.slice(5, 7));
  if (m >= 1 && m <= 3) return 1;
  if (m >= 4 && m <= 6) return 2;
  if (m >= 7 && m <= 9) return 3;
  return 4;
}

export function quarterLabel(year: number, q: QuarterKey): string {
  const start = ["Jan", "Apr", "Jul", "Oct"][q - 1];
  const end = ["Mar", "Jun", "Sep", "Dec"][q - 1];
  return `Q${q} ${year} (${start}–${end})`;
}

/**
 * Quarterly tax-ready report grouped by city then admission status. For each
 * bucket: number of events, total revenue, and revenue split by payment
 * method so an accountant can reconcile cash vs. digital deposits.
 */
export function buildQuarterlyReportCsv(
  state: AppState,
  year: number,
  quarter: QuarterKey,
): string {
  const events = state.events.filter(
    (e) => e.date.slice(0, 4) === String(year) && quarterOf(e.date) === quarter,
  );
  const eventIds = new Set(events.map((e) => e.id));
  const relevantOrders = state.orders.filter((o) => eventIds.has(o.eventId));

  // Aggregate by (city, admissionCharged) → totals.
  type Bucket = {
    city: string;
    admission: string;
    eventCount: number;
    totalRevenue: number;
    byMethod: Record<string, number>;
  };
  const buckets = new Map<string, Bucket>();

  function bucketKey(city: string, admission: string) {
    return `${city}|||${admission}`;
  }

  for (const e of events) {
    const city = (e.city ?? "").trim() || "Unspecified";
    const admission =
      e.admissionCharged === true
        ? "yes"
        : e.admissionCharged === false
          ? "no"
          : "unspecified";
    const key = bucketKey(city, admission);
    let b = buckets.get(key);
    if (!b) {
      b = { city, admission, eventCount: 0, totalRevenue: 0, byMethod: {} };
      buckets.set(key, b);
    }
    b.eventCount += 1;
  }

  for (const o of relevantOrders) {
    const evt = events.find((e) => e.id === o.eventId);
    if (!evt) continue;
    const city = (evt.city ?? "").trim() || "Unspecified";
    const admission =
      evt.admissionCharged === true
        ? "yes"
        : evt.admissionCharged === false
          ? "no"
          : "unspecified";
    const key = bucketKey(city, admission);
    const b = buckets.get(key);
    if (!b) continue;
    let orderRevenue = 0;
    for (const it of o.items) {
      const factor = 1 - Math.min(1, Math.max(0, (it.discountPct ?? 0) / 100));
      orderRevenue += it.priceSnap * factor * it.quantity;
    }
    b.totalRevenue += orderRevenue;
    const pm = o.paymentMethod ?? "unknown";
    b.byMethod[pm] = (b.byMethod[pm] ?? 0) + orderRevenue;
  }

  const methodsSeen = new Set<string>();
  for (const b of buckets.values()) {
    for (const k of Object.keys(b.byMethod)) methodsSeen.add(k);
  }
  const methodCols = Array.from(methodsSeen).sort();

  const rows: unknown[][] = [];
  rows.push([`Quarterly tax report — ${quarterLabel(year, quarter)}`]);
  rows.push([`Generated ${new Date().toISOString()}`]);
  rows.push([]);
  rows.push([
    "City",
    "Admission charged",
    "Events",
    "Total revenue (paid)",
    ...methodCols.map((m) => `Revenue via ${m}`),
  ]);

  const sorted = [...buckets.values()].sort(
    (a, b) => a.city.localeCompare(b.city) || a.admission.localeCompare(b.admission),
  );
  let grandTotal = 0;
  let grandEvents = 0;
  const grandByMethod: Record<string, number> = {};
  for (const b of sorted) {
    grandTotal += b.totalRevenue;
    grandEvents += b.eventCount;
    for (const m of methodCols) grandByMethod[m] = (grandByMethod[m] ?? 0) + (b.byMethod[m] ?? 0);
    rows.push([
      b.city,
      b.admission,
      b.eventCount,
      b.totalRevenue.toFixed(2),
      ...methodCols.map((m) => (b.byMethod[m] ?? 0).toFixed(2)),
    ]);
  }
  rows.push([]);
  rows.push([
    "GRAND TOTAL",
    "",
    grandEvents,
    grandTotal.toFixed(2),
    ...methodCols.map((m) => (grandByMethod[m] ?? 0).toFixed(2)),
  ]);

  rows.push([]);
  rows.push(["Events included this quarter"]);
  rows.push([
    "Event name",
    "Date",
    "City",
    "Admission charged",
    "Kind",
    "Event type",
    "Notes",
  ]);
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      e.name,
      e.date,
      e.city ?? "",
      e.admissionCharged === true ? "yes" : e.admissionCharged === false ? "no" : "",
      e.kind ?? "live",
      e.eventType ?? "standard",
      e.notes ?? "",
    ]);
  }

  return toCsv(rows);
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(csv: string, filename: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
