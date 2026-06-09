"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Download, Target, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Select } from "@/components/ui";
import { useActiveEvent, useStore } from "@/lib/store";
import { computeEventTotals, expandCombosInByItem } from "@/lib/calc";
import type { Event, MenuSnapshot, Order } from "@/lib/types";
import { cn, formatMoney, formatPct } from "@/lib/utils";

const ALL_EVENTS = "__all__";

export default function EventSummary() {
  const { state, dispatch } = useStore();
  const activeEvent = useActiveEvent();
  const [deleting, startDelete] = useTransition();

  // Default to active event; otherwise the most-recent event.
  const sortedEvents = useMemo(
    () => [...state.events].sort((a, b) => b.date.localeCompare(a.date)),
    [state.events],
  );
  const [selectedEventId, setSelectedEventId] = useState<string>(
    activeEvent?.id ?? sortedEvents[0]?.id ?? "",
  );

  const isAllEvents = selectedEventId === ALL_EVENTS;

  const event = isAllEvents ? undefined : state.events.find((e) => e.id === selectedEventId);
  const snapshot = event
    ? state.menuSnapshots.find((s) => s.id === event.menuSnapshotId)
    : undefined;
  const orders = useMemo(
    () => (event ? state.orders.filter((o) => o.eventId === event.id) : []),
    [event, state.orders],
  );

  const totals = useMemo(
    () => (event && snapshot ? computeEventTotals(snapshot, event.fixedCosts, orders) : null),
    [event, snapshot, orders],
  );

  // Time-of-day binning: hourly buckets across the event window.
  // Called unconditionally to keep hook order stable across the empty-state branch.
  const timeBuckets = useMemo(
    () => (event ? buildTimeBuckets(event, orders) : []),
    [event, orders],
  );

  // Aggregate across every event for the "All events" view.
  const aggregate = useMemo(
    () => (isAllEvents ? buildAllEventsAggregate(state) : null),
    [isAllEvents, state],
  );

  // Show empty state only if we have no events at all.
  if (state.events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="Create an event in Live Orders to see a summary here."
      />
    );
  }

  if (isAllEvents && aggregate) {
    return (
      <AllEventsView
        aggregate={aggregate}
        sortedEvents={sortedEvents}
        selectedEventId={selectedEventId}
        onSelectEvent={setSelectedEventId}
        threshold={state.settings.lowMarginThresholdPct / 100}
      />
    );
  }

  if (!event || !snapshot || !totals) {
    // Fallback: previously-selected event was deleted. Auto-jump to all-events.
    return (
      <AllEventsView
        aggregate={buildAllEventsAggregate(state)}
        sortedEvents={sortedEvents}
        selectedEventId={ALL_EVENTS}
        onSelectEvent={setSelectedEventId}
        threshold={state.settings.lowMarginThresholdPct / 100}
      />
    );
  }

  const threshold = state.settings.lowMarginThresholdPct / 100;

  // Sort items by quantity for chart readability.
  const itemsSorted = [...totals.byItem]
    .filter((t) => t.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  // Chart-only view: combo sales are split into their drink + pastry rows
  // (proportional to individual menu prices). Everything else — best-seller,
  // per-item table, CSV export — keeps the original aggregated Combo bucket.
  const chartItems = expandCombosInByItem(totals.byItem, snapshot, orders)
    .filter((t) => t.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  // Pastry detection runs off the menu item's size (not category) since the
  // user can label a pastry under any category. Built from the frozen snapshot
  // so historical events bucket the right way.
  const pastryIds = new Set(
    snapshot.menuItems.filter((m) => m.size === "pastry_count").map((m) => m.id),
  );

  const bestSeller = itemsSorted[0];
  const mostProfitable = [...totals.byItem]
    .filter((t) => t.profit > 0)
    .sort((a, b) => b.profit - a.profit)[0];

  // Fully-loaded margin = (price - (cost + fixedCostShare)) / price.
  const cupsForLoad = totals.totalCups;
  const fixedShare = cupsForLoad > 0 ? totals.fixedCosts / cupsForLoad : 0;

  const donationPct = event.donationPct ?? 0;
  const donationAmount = totals.revenuePaid * (donationPct / 100);
  const netProfit = totals.profit - donationAmount;
  const netMargin = totals.revenuePaid > 0 ? netProfit / totals.revenuePaid : null;

  const handleExport = () => {
    const csv = buildCsv(event, snapshot, orders, totals);
    downloadCsv(csv, `${event.name.replace(/\s+/g, "-")}_${event.date}.csv`);
  };

  const handleDelete = () => {
    if (!event) return;
    if (
      !confirm(
        `Delete "${event.name}" and all ${orders.length} of its orders? This cannot be undone.`,
      )
    ) {
      return;
    }
    const idToDelete = event.id;
    // Switch view away from the doomed event before the dispatch so we don't
    // try to render charts against a vanishing dataset.
    const remaining = sortedEvents.filter((e) => e.id !== idToDelete);
    if (remaining.length > 0) setSelectedEventId(remaining[0].id);
    // Mark the dispatch + cascading re-renders as a low-priority transition so
    // the button doesn't block the UI thread.
    startDelete(() => {
      dispatch({ type: "DELETE_EVENT", id: idToDelete });
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-display text-xl">Event Summary</h1>
          <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
            {event.name} · {event.date} · {event.startTime}–{event.endTime}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="text-sm"
          >
            <option value={ALL_EVENTS}>All events ({state.events.length})</option>
            {sortedEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} · {ev.date}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
            <Trash2 className="h-3.5 w-3.5" /> {deleting ? "deleting…" : "Delete event"}
          </Button>
        </div>
      </header>

      {event.notes ? (
        <div className="t-caption rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {event.notes}
        </div>
      ) : null}

      {/* Metrics */}
      <div className={cn(
        "grid grid-cols-2 gap-3",
        donationPct > 0 ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-3 xl:grid-cols-5",
      )}>
        <Metric
          label="Cups poured"
          value={totals.cupsPoured.toString()}
          subtext="drinks (oz)"
        />
        <Metric
          label="Pastries served"
          value={totals.pastriesServed.toString()}
        />
        <Metric
          label="Revenue (paid)"
          value={formatMoney(totals.revenuePaid)}
          subtext={
            totals.revenueGross > totals.revenuePaid
              ? `${formatMoney(totals.revenueGross - totals.revenuePaid)} in discounts`
              : undefined
          }
        />
        <Metric label="Total cost" value={formatMoney(totals.totalCost)} subtext={`incl. ${formatMoney(totals.fixedCosts)} fixed`} />
        {donationPct > 0 ? (
          <Metric
            label="Donation"
            value={formatMoney(donationAmount)}
            subtext={`${donationPct}% of revenue`}
          />
        ) : null}
        <Metric
          label={donationPct > 0 ? "Net profit" : "Profit"}
          value={formatMoney(donationPct > 0 ? netProfit : totals.profit)}
          subtext={
            donationPct > 0
              ? netMargin !== null
                ? `${formatPct(netMargin)} after donation`
                : "after donation"
              : totals.margin !== null
                ? `${formatPct(totals.margin)} margin`
                : undefined
          }
        />
      </div>

      {/* Revenue goal progress */}
      {event.targetRevenue && event.targetRevenue > 0 ? (
        <Card>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Target className="h-4 w-4 text-matcha-600" /> Revenue goal
            </span>
            <span className="tabular-nums text-matcha-900/70">
              {formatMoney(totals.revenuePaid)} / {formatMoney(event.targetRevenue)}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream-100">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                totals.revenuePaid >= event.targetRevenue ? "bg-matcha-500" : "bg-matcha-400",
              )}
              style={{
                width: `${Math.min(100, Math.round((totals.revenuePaid / event.targetRevenue) * 100))}%`,
              }}
            />
          </div>
        </Card>
      ) : null}

      {/* Highlights */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {bestSeller ? (
          <Card>
            <div className="t-display text-xs text-matcha-900/60">Best seller</div>
            <div className="t-display mt-1 text-lg">{bestSeller.name}</div>
            <div className="t-caption mt-0.5 text-sm text-matcha-900/70">
              {bestSeller.qty} cups · {formatMoney(bestSeller.revenuePaid)} revenue
            </div>
          </Card>
        ) : null}
        {mostProfitable ? (
          <Card>
            <div className="t-display text-xs text-matcha-900/60">Most profitable</div>
            <div className="t-display mt-1 text-lg">{mostProfitable.name}</div>
            <div className="t-caption mt-0.5 text-sm text-matcha-900/70">
              {formatMoney(mostProfitable.profit)} profit · {formatPct(mostProfitable.margin)}
            </div>
          </Card>
        ) : null}
      </div>

      {/* Chart 1: Quantity by item */}
      <Card>
        <h2 className="t-display mb-3 text-sm">Quantity sold by item</h2>
        {chartItems.length === 0 ? (
          <p className="text-sm text-matcha-900/60">No sales yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, chartItems.length * 36)}>
            <BarChart data={chartItems} layout="vertical" margin={{ left: 24, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D2" />
              <XAxis type="number" stroke="#6B7280" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="#374151" fontSize={11} width={120} tickFormatter={(v: string) => v.toLowerCase()} />
              <Tooltip
                formatter={(v: number, _name: string, item: { payload?: { menuItemId?: string } }) => {
                  const id = item?.payload?.menuItemId;
                  const isPastry = id ? pastryIds.has(id) : false;
                  const unit = isPastry ? (v === 1 ? "pastry" : "pastries") : v === 1 ? "cup" : "cups";
                  return [`${v} ${unit}`, "Quantity"];
                }}
                labelFormatter={(label) => String(label).toLowerCase()}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="qty" fill="#7A9C5E" radius={[0, 6, 6, 0]}>
                {chartItems.map((it) => (
                  <Cell key={it.menuItemId} fill="#7A9C5E" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Chart 2: Revenue & profit by item, grouped */}
      <Card>
        <h2 className="t-display mb-3 text-sm">Revenue & profit by item</h2>
        {chartItems.length === 0 ? (
          <p className="text-sm text-matcha-900/60">No sales yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, chartItems.length * 44)}>
            <BarChart data={chartItems} layout="vertical" margin={{ left: 24, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D2" />
              <XAxis type="number" stroke="#6B7280" fontSize={11} tickFormatter={(v: number) => `$${v}`} />
              <YAxis type="category" dataKey="name" stroke="#374151" fontSize={11} width={120} tickFormatter={(v: string) => v.toLowerCase()} />
              <Tooltip
                formatter={(v: number, name: string) => [formatMoney(v as number), name]}
                labelFormatter={(label) => String(label).toLowerCase()}
                contentStyle={tooltipStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenuePaid" name="Revenue" fill="#7A9C5E" radius={[0, 6, 6, 0]} />
              <Bar dataKey="profit" name="Profit" fill="#C7A86B" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Chart 3: Orders over time of day — only meaningful for live events
          where each order has a real submitted_at timestamp. */}
      {event.kind !== "past" ? (
      <Card>
        <h2 className="t-display mb-3 text-sm">Orders over time of day</h2>
        {timeBuckets.length === 0 ? (
          <p className="text-sm text-matcha-900/60">No orders yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={timeBuckets} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D2" />
              <XAxis dataKey="label" stroke="#6B7280" fontSize={11} />
              <YAxis stroke="#6B7280" fontSize={11} allowDecimals={false} />
              <Tooltip
                formatter={(v: number) => [`${v} orders`, "Orders"]}
                contentStyle={tooltipStyle}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#7A9C5E"
                strokeWidth={2}
                dot={{ r: 3, fill: "#7A9C5E" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
      ) : null}

      {/* Per-item table with margins (fully-loaded) */}
      <Card>
        <h2 className="t-display mb-3 text-sm">Per-item breakdown</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="t-display text-left text-xs text-matcha-900/60">
                <th className="py-2 pr-4">Item</th>
                <th className="py-2 pr-4 text-right">Qty</th>
                <th className="py-2 pr-4 text-right">Revenue</th>
                <th className="py-2 pr-4 text-right">Ingredient cost</th>
                <th className="py-2 pr-4 text-right">Loaded margin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...totals.byItem]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
                .map((t) => {
                const price = t.priceSnap;
                const loaded = t.costSnapAvg + fixedShare;
                const loadedMargin = price > 0 ? (price - loaded) / price : null;
                const low = loadedMargin !== null && loadedMargin < threshold;
                return (
                  <tr key={t.menuItemId} className="border-t border-cream-100">
                    <td className="py-2 pr-4 font-medium lowercase">{t.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{t.qty}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.revenuePaid)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.totalCost)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatPct(loadedMargin)}</td>
                    <td className="py-2 pr-4">
                      {low && t.qty > 0 ? (
                        <Badge variant="warning">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Low
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-cream-200">
                <td className="py-2 pr-4 font-semibold">Totals</td>
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">{totals.totalCups}</td>
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(totals.revenuePaid)}</td>
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(totals.ingredientCost)}</td>
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatPct(totals.margin)}</td>
                <td />
              </tr>
              {donationPct > 0 ? (
                <>
                  <tr className="border-t border-cream-100 text-matcha-900/70">
                    <td className="py-2 pr-4">− Donation ({donationPct}% of revenue)</td>
                    <td />
                    <td className="py-2 pr-4 text-right tabular-nums">−{formatMoney(donationAmount)}</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                  <tr className="border-t-2 border-cream-200">
                    <td className="py-2 pr-4 font-semibold">Net (after donation)</td>
                    <td />
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(totals.revenuePaid - donationAmount)}</td>
                    <td />
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatPct(netMargin)}</td>
                    <td />
                  </tr>
                </>
              ) : null}
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-matcha-900/60">
          Loaded margin includes the per-cup share of fixed costs ({formatMoney(fixedShare)}/cup based on {totals.totalCups} cups).
        </p>
      </Card>

    </div>
  );
}

function Metric({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <Card className="!py-3 !px-4">
      <div className="t-display text-[11px] text-matcha-900/60">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {subtext ? <div className="t-caption mt-0.5 text-xs text-matcha-900/60">{subtext}</div> : null}
    </Card>
  );
}

type TimeBucket = { label: string; count: number; hour: number };

function buildTimeBuckets(event: Event, orders: Order[]): TimeBucket[] {
  // Use submittedAt in the local timezone of the device.
  // Choose hour buckets that span min..max submission hour, with event start/end as fallbacks.
  const active = orders.filter((o) => o.status !== "cancelled");
  if (active.length === 0) return [];

  const hours = active.map((o) => new Date(o.submittedAt).getHours());
  let lo = Math.min(...hours);
  let hi = Math.max(...hours);

  // Expand to include start/end times if provided.
  const startH = parseHour(event.startTime);
  const endH = parseHour(event.endTime);
  if (startH !== null) lo = Math.min(lo, startH);
  if (endH !== null) hi = Math.max(hi, endH);

  const buckets: TimeBucket[] = [];
  for (let h = lo; h <= hi; h++) {
    buckets.push({ hour: h, label: formatHour(h), count: 0 });
  }
  for (const o of active) {
    const h = new Date(o.submittedAt).getHours();
    const b = buckets.find((x) => x.hour === h);
    if (b) b.count += 1;
  }
  return buckets;
}

function parseHour(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const [h] = hhmm.split(":").map(Number);
  return Number.isFinite(h) ? h : null;
}

function formatHour(h: number): string {
  const period = h >= 12 ? "p" : "a";
  const hour = ((h + 11) % 12) + 1;
  return `${hour}${period}`;
}

const tooltipStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #E8E2D2",
  background: "white",
  fontSize: 12,
};

// ----- CSV export -----

function buildCsv(
  event: Event,
  _snapshot: MenuSnapshot,
  _orders: Order[],
  totals: ReturnType<typeof computeEventTotals>,
): string {
  const rows: string[][] = [];

  // Header rows
  rows.push(["Event Name", event.name]);
  rows.push(["Event Date", event.date]);
  rows.push(["Start Time", event.startTime]);
  rows.push(["End Time", event.endTime]);
  if (event.targetRevenue) rows.push(["Revenue Goal", event.targetRevenue.toFixed(2)]);
  rows.push([]);

  // Per-item table
  rows.push([
    "Item",
    "Quantity Sold",
    "Price",
    "Revenue (paid)",
    "Avg Cost per Item",
    "Total Cost",
    "Profit",
    "Margin %",
  ]);
  for (const t of totals.byItem) {
    rows.push([
      t.name,
      String(t.qty),
      t.priceSnap.toFixed(2),
      t.revenuePaid.toFixed(2),
      t.costSnapAvg.toFixed(4),
      t.totalCost.toFixed(2),
      t.profit.toFixed(2),
      t.margin !== null ? (t.margin * 100).toFixed(1) : "",
    ]);
  }
  rows.push([]);

  // Totals
  rows.push(["Totals"]);
  rows.push(["Total Orders", String(totals.totalOrders)]);
  rows.push(["Cups Poured", String(totals.cupsPoured)]);
  rows.push(["Pastries Served", String(totals.pastriesServed)]);
  rows.push(["Revenue", totals.revenuePaid.toFixed(2)]);
  rows.push(["Gross (before discounts)", totals.revenueGross.toFixed(2)]);
  rows.push(["Ingredient Cost", totals.ingredientCost.toFixed(2)]);
  rows.push(["Fixed Costs", totals.fixedCosts.toFixed(2)]);
  rows.push(["Total Cost", totals.totalCost.toFixed(2)]);
  rows.push(["Profit", totals.profit.toFixed(2)]);
  rows.push(["Overall Margin %", totals.margin !== null ? (totals.margin * 100).toFixed(1) : ""]);
  rows.push([]);

  // Fixed costs detail
  if (event.fixedCosts.length > 0) {
    rows.push(["Fixed Costs"]);
    for (const fc of event.fixedCosts) {
      rows.push([fc.name, fc.amount.toFixed(2)]);
    }
    rows.push([]);
  }

  return rows.map(toCsvRow).join("\r\n");
}

function toCsvRow(row: string[]): string {
  return row
    .map((field) => {
      if (field == null) return "";
      const s = String(field);
      if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(",");
}

function downloadCsv(csv: string, filename: string) {
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

// ============================================================
// All-events aggregate
// ============================================================

type PerEventTotal = {
  id: string;
  name: string;
  date: string;
  shortLabel: string;
  revenue: number;
  cost: number;
  profit: number;
  cups: number;
};

type AggregatedItem = {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
};

type AllEventsAggregate = {
  eventCount: number;
  totalCups: number;
  totalCupsPoured: number;
  totalPastriesServed: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  overallMargin: number | null;
  /** Sum of every inventory_purchase.amount in the workspace. */
  inventorySpending: number;
  /** Sum of per-event (revenue × donationPct/100). */
  totalDonations: number;
  /** revenue − totalCost − totalDonations − inventorySpending. */
  netProfit: number;
  /** netProfit / revenue. */
  netMargin: number | null;
  byItem: AggregatedItem[];
  bestSeller: AggregatedItem | null;
  mostProfitable: AggregatedItem | null;
  perEvent: PerEventTotal[];
};

function buildAllEventsAggregate(state: import("@/lib/types").AppState): AllEventsAggregate {
  const events = [...state.events].sort((a, b) => a.date.localeCompare(b.date));

  let totalCups = 0;
  let totalCupsPoured = 0;
  let totalPastriesServed = 0;
  let totalRevenue = 0;
  let totalCost = 0;
  let totalProfit = 0;
  let totalDonations = 0;

  // Combine per-item across all events, keyed by display name (snapshot IDs
  // differ across events so name is the stable joiner).
  const byName = new Map<string, AggregatedItem>();
  const perEvent: PerEventTotal[] = [];

  for (const evt of events) {
    const snap = state.menuSnapshots.find((s) => s.id === evt.menuSnapshotId);
    if (!snap) continue;
    const eventOrders = state.orders.filter((o) => o.eventId === evt.id);
    const t = computeEventTotals(snap, evt.fixedCosts, eventOrders);

    totalCups += t.totalCups;
    totalCupsPoured += t.cupsPoured;
    totalPastriesServed += t.pastriesServed;
    totalRevenue += t.revenuePaid;
    totalCost += t.totalCost;
    totalProfit += t.profit;
    if (evt.donationPct && evt.donationPct > 0) {
      totalDonations += t.revenuePaid * (evt.donationPct / 100);
    }

    for (const it of t.byItem) {
      if (it.qty === 0) continue;
      const existing = byName.get(it.name) ?? {
        name: it.name,
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: null,
      };
      existing.qty += it.qty;
      existing.revenue += it.revenuePaid;
      existing.cost += it.totalCost;
      existing.profit += it.profit;
      byName.set(it.name, existing);
    }

    perEvent.push({
      id: evt.id,
      name: evt.name,
      date: evt.date,
      shortLabel:
        evt.name.length > 16 ? `${evt.name.slice(0, 14)}…` : evt.name,
      revenue: t.revenuePaid,
      cost: t.totalCost,
      profit: t.profit,
      cups: t.totalCups,
    });
  }

  const byItem = Array.from(byName.values()).map((it) => ({
    ...it,
    margin: it.revenue > 0 ? (it.revenue - it.cost) / it.revenue : null,
  }));

  const bestSeller =
    byItem.length > 0
      ? [...byItem].sort((a, b) => b.qty - a.qty)[0]
      : null;
  const mostProfitable =
    byItem.length > 0
      ? [...byItem].filter((i) => i.profit > 0).sort((a, b) => b.profit - a.profit)[0] ?? null
      : null;

  const inventorySpending = state.inventoryPurchases.reduce((s, p) => s + p.amount, 0);
  const netProfit = totalRevenue - totalCost - totalDonations - inventorySpending;

  return {
    eventCount: events.length,
    totalCups,
    totalCupsPoured,
    totalPastriesServed,
    totalRevenue,
    totalCost,
    totalProfit,
    overallMargin: totalRevenue > 0 ? totalProfit / totalRevenue : null,
    inventorySpending,
    totalDonations,
    netProfit,
    netMargin: totalRevenue > 0 ? netProfit / totalRevenue : null,
    byItem,
    bestSeller,
    mostProfitable,
    perEvent,
  };
}

function AllEventsView({
  aggregate,
  sortedEvents,
  selectedEventId,
  onSelectEvent,
  threshold,
}: {
  aggregate: AllEventsAggregate;
  sortedEvents: import("@/lib/types").Event[];
  selectedEventId: string;
  onSelectEvent: (id: string) => void;
  threshold: number;
}) {
  const itemsByQty = [...aggregate.byItem].sort((a, b) => b.qty - a.qty);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-display text-xl">All Events</h1>
          <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
            combined across {aggregate.eventCount} event{aggregate.eventCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedEventId}
            onChange={(e) => onSelectEvent(e.target.value)}
            className="text-sm"
          >
            <option value={ALL_EVENTS}>All events ({aggregate.eventCount})</option>
            {sortedEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} · {ev.date}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <Metric
          label="Cups poured"
          value={aggregate.totalCupsPoured.toString()}
          subtext={`${aggregate.eventCount} events`}
        />
        <Metric
          label="Pastries served"
          value={aggregate.totalPastriesServed.toString()}
        />
        <Metric label="Total revenue" value={formatMoney(aggregate.totalRevenue)} />
        <Metric
          label="Event costs"
          value={formatMoney(aggregate.totalCost)}
          subtext="ingredients + per-event fixed"
        />
        <Metric
          label="Donations"
          value={formatMoney(aggregate.totalDonations)}
          subtext={aggregate.totalDonations > 0 ? "charity events" : "none recorded"}
        />
        <Metric
          label="Inventory spending"
          value={formatMoney(aggregate.inventorySpending)}
          subtext="supplies / bulk purchases"
        />
        <Metric
          label="Net profit"
          value={formatMoney(aggregate.netProfit)}
          subtext={
            aggregate.netMargin !== null
              ? `${formatPct(aggregate.netMargin)} net margin`
              : "after donations + inventory"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {aggregate.bestSeller ? (
          <Card>
            <div className="t-display text-xs text-matcha-900/60">Best seller overall</div>
            <div className="t-display mt-1 text-lg">{aggregate.bestSeller.name}</div>
            <div className="t-caption mt-0.5 text-sm text-matcha-900/70">
              {aggregate.bestSeller.qty} cups · {formatMoney(aggregate.bestSeller.revenue)} revenue
            </div>
          </Card>
        ) : null}
        {aggregate.mostProfitable ? (
          <Card>
            <div className="t-display text-xs text-matcha-900/60">Most profitable overall</div>
            <div className="t-display mt-1 text-lg">{aggregate.mostProfitable.name}</div>
            <div className="t-caption mt-0.5 text-sm text-matcha-900/70">
              {formatMoney(aggregate.mostProfitable.profit)} profit · {formatPct(aggregate.mostProfitable.margin)}
            </div>
          </Card>
        ) : null}
      </div>

      <Card>
        <h2 className="t-display mb-3 text-sm">Revenue & profit per event</h2>
        {aggregate.perEvent.length === 0 ? (
          <p className="t-caption text-sm text-matcha-900/60">no sales recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, aggregate.perEvent.length * 50)}>
            <BarChart
              data={aggregate.perEvent}
              layout="vertical"
              margin={{ left: 24, right: 16, top: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D2" />
              <XAxis
                type="number"
                stroke="#6B7280"
                fontSize={11}
                tickFormatter={(v: number) => `$${v}`}
              />
              <YAxis
                type="category"
                dataKey="shortLabel"
                stroke="#374151"
                fontSize={11}
                width={130}
              />
              <Tooltip
                formatter={(v: number, name: string) => [formatMoney(v as number), name]}
                labelFormatter={(label, payload) => {
                  const row = (payload && payload[0]?.payload) as PerEventTotal | undefined;
                  return row ? `${row.name} · ${row.date}` : String(label);
                }}
                contentStyle={tooltipStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" name="Revenue" fill="#7A9C5E" radius={[0, 6, 6, 0]} />
              <Bar dataKey="profit" name="Profit" fill="#C7A86B" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <h2 className="t-display mb-3 text-sm">Per-item breakdown (all events)</h2>
        {itemsByQty.length === 0 ? (
          <p className="t-caption text-sm text-matcha-900/60">no sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="t-display text-left text-xs text-matcha-900/60">
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4 text-right">Qty</th>
                  <th className="py-2 pr-4 text-right">Revenue</th>
                  <th className="py-2 pr-4 text-right">Cost</th>
                  <th className="py-2 pr-4 text-right">Profit</th>
                  <th className="py-2 pr-4 text-right">Margin</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itemsByQty.map((t) => {
                  const low = t.margin !== null && t.margin < threshold;
                  return (
                    <tr key={t.name} className="border-t border-cream-100">
                      <td className="py-2 pr-4 font-medium lowercase">{t.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{t.qty}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.revenue)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.cost)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(t.profit)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatPct(t.margin)}</td>
                      <td className="py-2 pr-4">
                        {low && t.qty > 0 ? (
                          <Badge variant="warning">
                            <AlertTriangle className="mr-1 h-3 w-3" /> Low
                          </Badge>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-cream-200">
                  <td className="py-2 pr-4 font-semibold">Event totals</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{aggregate.totalCups}</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(aggregate.totalRevenue)}</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(aggregate.totalCost)}</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(aggregate.totalProfit)}</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatPct(aggregate.overallMargin)}</td>
                  <td />
                </tr>
                {aggregate.totalDonations > 0 ? (
                  <tr className="border-t border-cream-100 text-matcha-900/70">
                    <td className="py-2 pr-4">− Donations</td>
                    <td />
                    <td className="py-2 pr-4 text-right tabular-nums">−{formatMoney(aggregate.totalDonations)}</td>
                    <td />
                    <td className="py-2 pr-4 text-right tabular-nums">−{formatMoney(aggregate.totalDonations)}</td>
                    <td />
                    <td />
                  </tr>
                ) : null}
                {aggregate.inventorySpending > 0 ? (
                  <tr className="border-t border-cream-100 text-matcha-900/70">
                    <td className="py-2 pr-4">− Inventory spending</td>
                    <td />
                    <td />
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(aggregate.inventorySpending)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">−{formatMoney(aggregate.inventorySpending)}</td>
                    <td />
                    <td />
                  </tr>
                ) : null}
                {aggregate.totalDonations > 0 || aggregate.inventorySpending > 0 ? (
                  <tr className="border-t-2 border-cream-200">
                    <td className="py-2 pr-4 font-semibold">Net</td>
                    <td />
                    <td />
                    <td />
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatMoney(aggregate.netProfit)}</td>
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatPct(aggregate.netMargin)}</td>
                    <td />
                  </tr>
                ) : null}
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
