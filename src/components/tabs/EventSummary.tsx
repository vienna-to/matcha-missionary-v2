"use client";

import { useMemo, useState } from "react";
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
import { AlertTriangle, Download, Target } from "lucide-react";
import { Badge, Button, Card, EmptyState, Select } from "@/components/ui";
import { useActiveEvent, useStore } from "@/lib/store";
import { computeEventTotals } from "@/lib/calc";
import type { Event, MenuSnapshot, Order } from "@/lib/types";
import { cn, formatMoney, formatPct } from "@/lib/utils";

export default function EventSummary() {
  const { state } = useStore();
  const activeEvent = useActiveEvent();

  // Default to active event; otherwise the most-recent event.
  const sortedEvents = useMemo(
    () => [...state.events].sort((a, b) => b.date.localeCompare(a.date)),
    [state.events],
  );
  const [selectedEventId, setSelectedEventId] = useState<string>(
    activeEvent?.id ?? sortedEvents[0]?.id ?? "",
  );

  const event = state.events.find((e) => e.id === selectedEventId);
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

  if (!event || !snapshot || !totals) {
    return (
      <EmptyState
        title="No events yet"
        description="Create an event in Live Orders to see a summary here."
      />
    );
  }

  const threshold = state.settings.lowMarginThresholdPct / 100;

  // Sort items by quantity for chart readability.
  const itemsSorted = [...totals.byItem]
    .filter((t) => t.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  const bestSeller = itemsSorted[0];
  const mostProfitable = [...totals.byItem]
    .filter((t) => t.profit > 0)
    .sort((a, b) => b.profit - a.profit)[0];

  // Fully-loaded margin = (price - (cost + fixedCostShare)) / price.
  const cupsForLoad = totals.totalCups;
  const fixedShare = cupsForLoad > 0 ? totals.fixedCosts / cupsForLoad : 0;

  const handleExport = () => {
    const csv = buildCsv(event, snapshot, orders, totals);
    downloadCsv(csv, `${event.name.replace(/\s+/g, "-")}_${event.date}.csv`);
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
          {sortedEvents.length > 1 ? (
            <Select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="text-sm"
            >
              {sortedEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} · {ev.date}
                </option>
              ))}
            </Select>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </header>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Cups poured" value={totals.totalCups.toString()} subtext={`${totals.byItem.length} menu items`} />
        <Metric
          label="Revenue (paid)"
          value={formatMoney(totals.revenuePaid)}
          subtext={totals.revenueOwed > 0 ? `+ ${formatMoney(totals.revenueOwed)} owed` : undefined}
        />
        <Metric label="Total cost" value={formatMoney(totals.totalCost)} subtext={`incl. ${formatMoney(totals.fixedCosts)} fixed`} />
        <Metric
          label="Profit"
          value={formatMoney(totals.profit)}
          subtext={totals.margin !== null ? `${formatPct(totals.margin)} margin` : undefined}
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
        {itemsSorted.length === 0 ? (
          <p className="text-sm text-matcha-900/60">No sales yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, itemsSorted.length * 36)}>
            <BarChart data={itemsSorted} layout="vertical" margin={{ left: 24, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D2" />
              <XAxis type="number" stroke="#6B7280" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="#374151" fontSize={11} width={120} />
              <Tooltip
                formatter={(v: number) => [`${v} cups`, "Quantity"]}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="qty" fill="#7A9C5E" radius={[0, 6, 6, 0]}>
                {itemsSorted.map((it) => (
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
        {itemsSorted.length === 0 ? (
          <p className="text-sm text-matcha-900/60">No sales yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, itemsSorted.length * 44)}>
            <BarChart data={itemsSorted} layout="vertical" margin={{ left: 24, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D2" />
              <XAxis type="number" stroke="#6B7280" fontSize={11} tickFormatter={(v: number) => `$${v}`} />
              <YAxis type="category" dataKey="name" stroke="#374151" fontSize={11} width={120} />
              <Tooltip
                formatter={(v: number, name: string) => [formatMoney(v as number), name]}
                contentStyle={tooltipStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenuePaid" name="Revenue" fill="#7A9C5E" radius={[0, 6, 6, 0]} />
              <Bar dataKey="profit" name="Profit" fill="#C7A86B" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Chart 3: Orders over time of day */}
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
              {totals.byItem.map((t) => {
                const price = t.priceSnap;
                const loaded = t.costSnapAvg + fixedShare;
                const loadedMargin = price > 0 ? (price - loaded) / price : null;
                const low = loadedMargin !== null && loadedMargin < threshold;
                return (
                  <tr key={t.menuItemId} className="border-t border-cream-100">
                    <td className="py-2 pr-4 font-medium">{t.name}</td>
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
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-matcha-900/60">
          Loaded margin includes the per-cup share of fixed costs ({formatMoney(fixedShare)}/cup based on {totals.totalCups} cups).
        </p>
      </Card>

      {/* Payment mix */}
      <Card>
        <h2 className="t-display mb-3 text-sm">Payment breakdown</h2>
        <PaymentMix totals={totals} />
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

function PaymentMix({ totals }: { totals: ReturnType<typeof computeEventTotals> }) {
  const sums = totals.byItem.reduce(
    (acc, t) => {
      acc.cash += t.cashPaidQty;
      acc.venmo += t.venmoPaidQty;
      acc.zelle += t.zellePaidQty;
      acc.card += t.cardPaidQty;
      acc.other += t.otherPaidQty;
      return acc;
    },
    { cash: 0, venmo: 0, zelle: 0, card: 0, other: 0 },
  );
  const rows = [
    { label: "Cash", count: sums.cash },
    { label: "Venmo", count: sums.venmo },
    { label: "Zelle", count: sums.zelle },
    { label: "Card", count: sums.card },
    { label: "Other", count: sums.other },
  ].filter((r) => r.count > 0);
  if (rows.length === 0) {
    return <p className="text-sm text-matcha-900/60">No paid orders yet.</p>;
  }
  const paidTotal = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = paidTotal > 0 ? r.count / paidTotal : 0;
        return (
          <div key={r.label}>
            <div className="flex justify-between text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums text-matcha-900/70">
                {r.count} cups · {formatPct(pct)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-100">
              <div className="h-full bg-matcha-500" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-matcha-900/60">
        Counts cups across paid orders only. Unpaid: {totals.unpaidOrders} orders ({formatMoney(totals.revenueOwed)} owed). Comped: {totals.compedOrders}. Cancelled: {totals.cancelledOrders}.
      </p>
    </div>
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
  rows.push(["Cups Poured", String(totals.totalCups)]);
  rows.push(["Revenue (paid)", totals.revenuePaid.toFixed(2)]);
  rows.push(["Revenue (owed)", totals.revenueOwed.toFixed(2)]);
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

  // Payment breakdown
  const pm = totals.byItem.reduce(
    (a, t) => ({
      cash: a.cash + t.cashPaidQty,
      venmo: a.venmo + t.venmoPaidQty,
      zelle: a.zelle + t.zellePaidQty,
      card: a.card + t.cardPaidQty,
      other: a.other + t.otherPaidQty,
    }),
    { cash: 0, venmo: 0, zelle: 0, card: 0, other: 0 },
  );
  rows.push(["Payment Mix (cups)"]);
  rows.push(["Cash", String(pm.cash)]);
  rows.push(["Venmo", String(pm.venmo)]);
  rows.push(["Zelle", String(pm.zelle)]);
  rows.push(["Card", String(pm.card)]);
  rows.push(["Other", String(pm.other)]);

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
