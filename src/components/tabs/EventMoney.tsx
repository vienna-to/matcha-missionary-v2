"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { useStore } from "@/lib/store";
import { computeCollected, type EventTotals } from "@/lib/calc";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type Event,
  type Order,
  type PaymentMethod,
} from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

const methodLabel = (m: PaymentMethod | "unknown") =>
  m === "unknown" ? "Not recorded" : PAYMENT_METHOD_LABELS[m];

/**
 * Event money: what sold (paid vs free vs discounted), sales revenue, extra
 * received (round-ups, tips, standalone entries), total collected, and a
 * per-payment-method breakdown that should match each account or the cash box.
 *
 * Extra is never part of sales revenue; Total collected = revenue + extra.
 */
export default function EventMoney({
  event,
  orders,
  totals,
}: {
  event: Event;
  orders: Order[];
  totals: EventTotals;
}) {
  const { state, dispatch } = useStore();
  const extras = useMemo(
    () =>
      state.eventExtras
        .filter((x) => x.eventId === event.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.eventExtras, event.id],
  );
  const collected = useMemo(() => computeCollected(orders, extras), [orders, extras]);

  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("venmo");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addExtra() {
    const amount = Math.round(parseFloat(amountText) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a tip amount greater than $0.");
      return;
    }
    dispatch({
      type: "ADD_EVENT_EXTRA",
      extra: {
        eventId: event.id,
        amount,
        paymentMethod: method,
        note: note.trim() || undefined,
      },
    });
    setAmountText("");
    setNote("");
    setError(null);
  }

  return (
    <Card>
      <h2 className="t-display mb-3 text-sm">Sales and tips</h2>

      <dl className="space-y-1.5 text-sm">
        <Line label="Items sold" value={String(totals.itemsSold)} />
        <Line
          label="Free items given"
          value={`${totals.freeItems} (retail value ${formatMoney(totals.freeRetailValue)})`}
        />
        <Line
          label="Discounts given"
          value={`${formatMoney(totals.discountTotal)} across ${totals.discountedItems} item${
            totals.discountedItems === 1 ? "" : "s"
          }`}
        />
        <Line label="Sales revenue" value={formatMoney(collected.salesRevenue)} strong />
      </dl>

      <div className="my-3 border-t border-cream-100" />

      <dl className="space-y-1.5 text-sm">
        <Line label="Tips received" value={formatMoney(collected.extraTotal)} strong />
        <Line
          label="On orders"
          indent
          value={`${formatMoney(collected.orderExtra)} (${collected.ordersWithExtra} order${
            collected.ordersWithExtra === 1 ? "" : "s"
          })`}
        />
        <Line
          label="Average per order with a tip"
          indent
          value={collected.avgExtraPerOrder === null ? "None yet" : formatMoney(collected.avgExtraPerOrder)}
        />
        <Line
          label="Standalone tips"
          indent
          value={`${formatMoney(collected.standaloneExtra)} (${collected.standaloneCount} entr${
            collected.standaloneCount === 1 ? "y" : "ies"
          })`}
        />
        <Line label="Total collected" value={formatMoney(collected.totalCollected)} strong />
      </dl>
      <p className="t-caption mt-1 text-xs text-matcha-900/60">
        Total collected is sales revenue plus tips. Tips are never counted in revenue, profit or revenue share.
      </p>

      {collected.byMethod.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="t-display text-left text-xs text-matcha-900/60">
                <th className="py-2 pr-4 max-md:whitespace-nowrap max-md:pr-2">By payment method</th>
                <th className="py-2 pr-4 max-md:pr-2 text-right">Sales</th>
                <th className="py-2 pr-4 max-md:pr-2 text-right">Tips</th>
                <th className="py-2 pr-4 max-md:pr-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {collected.byMethod.map((b) => (
                <tr key={b.method} className="border-t border-cream-100">
                  <td className="py-2 pr-4 max-md:whitespace-nowrap max-md:pr-2 font-medium">{methodLabel(b.method)}</td>
                  <td className="py-2 pr-4 max-md:pr-2 text-right tabular-nums">{formatMoney(b.sales)}</td>
                  <td className="py-2 pr-4 max-md:pr-2 text-right tabular-nums">
                    {formatMoney(b.orderExtra + b.standaloneExtra)}
                  </td>
                  <td className="py-2 pr-4 max-md:pr-2 text-right font-semibold tabular-nums">{formatMoney(b.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-cream-200">
                <td className="py-2 pr-4 max-md:whitespace-nowrap max-md:pr-2 font-semibold">All methods</td>
                <td className="py-2 pr-4 max-md:pr-2 text-right font-semibold tabular-nums">
                  {formatMoney(collected.salesRevenue)}
                </td>
                <td className="py-2 pr-4 max-md:pr-2 text-right font-semibold tabular-nums">
                  {formatMoney(collected.extraTotal)}
                </td>
                <td className="py-2 pr-4 max-md:pr-2 text-right font-semibold tabular-nums">
                  {formatMoney(collected.totalCollected)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-cream-200 p-3">
        <div className="t-display mb-2 text-xs text-matcha-900/70">Add tip</div>
        <p className="t-caption mb-2 text-xs text-matcha-900/60">
          For a tip that is not tied to an order, like a Venmo sent after the event.
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[8rem_10rem_1fr_auto] md:items-end">
          <Field label="amount ($)">
            <Input
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value.replace(/[^0-9.]/g, ""));
                setError(null);
              }}
              placeholder="0.00"
            />
          </Field>
          <Field label="payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="note (optional)" className="col-span-2 md:col-span-1">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="who sent it?" />
          </Field>
          <Button onClick={addExtra} className="col-span-2 md:col-span-1">
            Add
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        {extras.length > 0 ? (
          <ul className="mt-3 divide-y divide-cream-100 text-sm">
            {extras.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {formatMoney(x.amount)} · {methodLabel(x.paymentMethod)}
                  </div>
                  <div className="t-caption truncate text-xs text-matcha-900/60">
                    {new Date(x.createdAt).toLocaleDateString()}
                    {x.note ? ` · ${x.note}` : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Delete tip"
                  onClick={() => {
                    if (confirm(`Delete this ${formatMoney(x.amount)} tip?`)) {
                      dispatch({ type: "DELETE_EVENT_EXTRA", id: x.id });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function Line({
  label,
  value,
  strong,
  indent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    // On phones every row has the same shape: label left, value right. The
    // label keeps its own width, and a value too long for the row wraps onto
    // its own line under the label instead of squeezing it.
    <div className="flex items-baseline justify-between gap-3 max-md:flex-wrap max-md:gap-y-0.5">
      <dt
        className={cn(
          "max-md:max-w-full",
          indent ? "pl-4 text-matcha-900/70" : strong ? "font-semibold" : undefined,
        )}
      >
        {label}
      </dt>
      <dd className={cn("max-md:ml-auto max-md:min-w-0 max-md:text-right", strong ? "font-semibold tabular-nums" : "tabular-nums")}>
        {value}
      </dd>
    </div>
  );
}
