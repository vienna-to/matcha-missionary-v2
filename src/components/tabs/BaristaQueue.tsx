"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  CheckCircle2,
  Coffee,
} from "lucide-react";
import { Volume2 } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { useActiveEvent, useStore } from "@/lib/store";
import { playPing, unlockAudio } from "@/lib/audio";
import { cn, formatMoney, formatTime, minutesAgo } from "@/lib/utils";
import type {
  Ingredient,
  MenuSnapshot,
  Order,
  OrderItem,
  OrderItemStatus,
} from "@/lib/types";
import EditOrderModal from "../EditOrderModal";

export default function BaristaQueue() {
  const event = useActiveEvent();
  const { state, dispatch } = useStore();
  const snapshot = event
    ? state.menuSnapshots.find((s) => s.id === event.menuSnapshotId)
    : undefined;

  const allOrders = useMemo(
    () =>
      event
        ? state.orders.filter((o) => o.eventId === event.id && o.status !== "cancelled")
        : [],
    [event, state.orders],
  );

  const active = allOrders
    .filter((o) => o.status !== "completed")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const completed = allOrders
    .filter((o) => o.status === "completed")
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  const [completedOpen, setCompletedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Detect fresh orders -> ping + flash
  const seenRef = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (seenRef.current === null) {
      // Initialize without firing on first render
      seenRef.current = new Set(allOrders.map((o) => o.id));
      return;
    }
    const fresh: string[] = [];
    for (const o of allOrders) {
      if (!seenRef.current.has(o.id)) {
        fresh.push(o.id);
        seenRef.current.add(o.id);
      }
    }
    if (fresh.length > 0) {
      // Both flags read fresh on each render via state ref; the effect re-runs on
      // either change, so we still hear the ping right after the user enables sound.
      if (state.settings.baristaPingEnabled && state.settings.audioUnlocked) playPing();
      setFreshIds((s) => {
        const next = new Set(s);
        fresh.forEach((id) => next.add(id));
        return next;
      });
      const timeout = setTimeout(() => {
        setFreshIds((s) => {
          const next = new Set(s);
          fresh.forEach((id) => next.delete(id));
          return next;
        });
      }, 1600);
      return () => clearTimeout(timeout);
    }
  }, [allOrders, state.settings.baristaPingEnabled, state.settings.audioUnlocked]);

  if (!event || !snapshot) {
    return (
      <EmptyState
        title="No active event"
        description="Set an active event to see incoming orders."
      />
    );
  }

  const editingOrder = editingId ? allOrders.find((o) => o.id === editingId) : undefined;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="t-display text-xl">Barista Queue</h1>
        <p className="t-caption mt-0.5 text-sm text-matcha-900/60">
          {active.length} active · {completed.length} completed
        </p>
      </header>

      {!state.settings.audioUnlocked && state.settings.baristaPingEnabled ? (
        <button
          onClick={() => {
            unlockAudio();
            playPing();
            dispatch({ type: "UPDATE_SETTINGS", patch: { audioUnlocked: true } });
          }}
          className="flex w-full items-center justify-between rounded-2xl border border-matcha-200 bg-matcha-50 px-4 py-3 text-left transition-colors hover:bg-matcha-100"
        >
          <span className="t-caption flex items-center gap-2 text-sm text-matcha-900">
            <Volume2 className="h-4 w-4 text-matcha-600" />
            tap to enable order alerts on this device
          </span>
          <span className="t-display text-xs text-matcha-700">Enable</span>
        </button>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          title="No active orders"
          description="New orders will appear here in real time."
        />
      ) : (
        <div className="space-y-3">
          {active.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              snapshot={snapshot}
              fresh={freshIds.has(o.id)}
              onStart={() =>
                dispatch({
                  type: "UPDATE_ORDER",
                  id: o.id,
                  patch: { status: "in_progress" },
                })
              }
              onCompleteAll={() => {
                dispatch({
                  type: "UPDATE_ORDER",
                  id: o.id,
                  patch: {
                    status: "completed",
                    items: o.items.map((it) => ({ ...it, status: "done" })),
                  },
                });
              }}
              onToggleItem={(itemId, status) =>
                dispatch({
                  type: "SET_ORDER_ITEM_STATUS",
                  orderId: o.id,
                  orderItemId: itemId,
                  status,
                })
              }
              onEdit={() => setEditingId(o.id)}
            />
          ))}
        </div>
      )}

      {completed.length > 0 ? (
        <section>
          <button
            onClick={() => setCompletedOpen((s) => !s)}
            className="flex w-full items-center justify-between rounded-xl bg-cream-100 px-4 py-3 text-sm font-medium text-matcha-900/80 hover:bg-cream-200"
          >
            <span>Completed today ({completed.length})</span>
            {completedOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {completedOpen ? (
            <div className="mt-3 space-y-2">
              {completed.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  snapshot={snapshot}
                  fresh={false}
                  compact
                  onStart={() => {}}
                  onCompleteAll={() => {}}
                  onToggleItem={() => {}}
                  onEdit={() => setEditingId(o.id)}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {editingOrder ? (
        <EditOrderModal
          order={editingOrder}
          snapshot={snapshot}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}

function OrderCard({
  order,
  snapshot,
  fresh,
  compact,
  onStart,
  onCompleteAll,
  onToggleItem,
  onEdit,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  fresh: boolean;
  compact?: boolean;
  onStart: () => void;
  onCompleteAll: () => void;
  onToggleItem: (itemId: string, status: OrderItemStatus) => void;
  onEdit: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (compact || order.status === "completed" || order.status === "cancelled") return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [compact, order.status]);

  const elapsed = minutesAgo(order.submittedAt, now);

  return (
    <Card
      className={cn(
        "transition-colors",
        fresh && "animate-flash border-matcha-300",
        order.status === "in_progress" && "border-blue-200 bg-blue-50/30",
        order.status === "completed" && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className={cn("font-semibold tabular-nums", compact ? "text-base" : "text-2xl")}>#{order.orderNumber}</div>
            <div className={cn("t-display truncate", compact ? "text-sm" : "text-lg")}>{order.customerName}</div>
            <StatusBadge status={order.status} />
            <PaymentBadge order={order} />
          </div>
          <div className={cn("mt-0.5 text-xs text-matcha-900/60", compact && "mt-0")}>
            {formatTime(order.submittedAt)}
            {elapsed > 0 && order.status !== "completed" ? ` · ${elapsed} min ago` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {!compact && order.status === "pending" ? (
            <Button size="sm" onClick={onStart}>
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          ) : null}
          {!compact && order.status !== "completed" ? (
            <Button size="sm" variant="outline" onClick={onCompleteAll}>
              <CheckCircle2 className="h-3.5 w-3.5" /> All done
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className={cn("mt-3 space-y-2", compact && "mt-2")}>
        {order.items.map((it) => (
          <OrderItemRow
            key={it.id}
            item={it}
            snapshot={snapshot}
            compact={compact}
            disabled={compact || order.status === "completed"}
            onToggle={() =>
              onToggleItem(
                it.id,
                it.status === "done"
                  ? "pending"
                  : it.status === "pending"
                  ? "done"
                  : "done",
              )
            }
          />
        ))}
      </div>

      {order.notes ? (
        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Note: {order.notes}
        </div>
      ) : null}
    </Card>
  );
}

function OrderItemRow({
  item,
  snapshot,
  compact,
  disabled,
  onToggle,
}: {
  item: OrderItem;
  snapshot: MenuSnapshot;
  compact?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const done = item.status === "done";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-cream-200 px-3 py-2",
        done && "bg-matcha-50/60 text-matcha-700 line-through",
      )}
    >
      <button
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-matcha-500 bg-matcha-500 text-white"
            : "border-cream-300 bg-white hover:border-matcha-400",
          disabled && "cursor-not-allowed opacity-50",
        )}
        aria-label={done ? "Mark as not done" : "Mark as done"}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn("t-display", compact ? "text-sm" : "text-base")}>
          {item.quantity}× {item.isCombo
            ? `Combo: ${item.menuItemNameSnap} + ${item.comboPastryNameSnap ?? "?"}`
            : item.menuItemNameSnap}
        </div>
        <ItemModifiers item={item} ingredients={snapshot.ingredients} />
      </div>
      <div className="shrink-0 text-right text-xs text-matcha-900/50 tabular-nums">
        {formatMoney(item.priceSnap * item.quantity)}
      </div>
    </div>
  );
}

function ItemModifiers({
  item,
  ingredients,
}: {
  item: OrderItem;
  ingredients: Ingredient[];
}) {
  const mods: string[] = [];
  if (item.milkChoiceId) {
    const ing = ingredients.find((i) => i.id === item.milkChoiceId);
    if (ing) mods.push(ing.name);
  }
  if (item.creamChoiceId === "none") {
    mods.push("no cream");
  } else if (item.creamChoiceId) {
    const ing = ingredients.find((i) => i.id === item.creamChoiceId);
    if (ing) mods.push(ing.name);
  }
  if (item.sugarAdjustment && item.sugarAdjustment !== "normal") {
    mods.push(
      item.sugarAdjustment === "less"
        ? "less sweet"
        : item.sugarAdjustment === "extra"
        ? "extra sweet"
        : "no agave",
    );
  }
  if (item.iceAdjustment && item.iceAdjustment !== "normal") {
    mods.push(item.iceAdjustment === "light" ? "light ice" : "extra ice");
  }
  if (item.specialRequests) mods.push(`"${item.specialRequests}"`);

  if (mods.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {mods.map((m, i) => (
        <span
          key={i}
          className="rounded-full bg-cream-100 px-2 py-0.5 text-[11px] text-matcha-900/70"
        >
          {m}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Order["status"] }) {
  const label =
    status === "pending"
      ? "Pending"
      : status === "in_progress"
      ? "In progress"
      : status === "completed"
      ? "Completed"
      : "Cancelled";
  return <Badge variant={status}>{label}</Badge>;
}

function PaymentBadge({ order }: { order: Order }) {
  const label =
    order.paymentStatus === "paid"
      ? order.paymentMethod
        ? `Paid · ${order.paymentMethod}`
        : "Paid"
      : order.paymentStatus === "unpaid"
      ? "Unpaid"
      : `Free${order.compReason ? ` · ${order.compReason}` : ""}`;
  return <Badge variant={order.paymentStatus}>{label}</Badge>;
}
