"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pencil,
  RotateCcw,
  Trash2,
  Volume2,
} from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import { DiscountRow } from "@/components/DiscountRow";
import { useActiveEvent, useStore } from "@/lib/store";
import { playPing, unlockAudio } from "@/lib/audio";
import { cn, formatTime, minutesAgo } from "@/lib/utils";
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

  // Two buckets: active (pending) on top, completed at the bottom.
  // Legacy "cancelled" orders are hidden (we removed that state).
  const { active, completed } = useMemo(() => {
    if (!event) return { active: [] as Order[], completed: [] as Order[] };
    const inEvent = state.orders.filter(
      (o) => o.eventId === event.id && o.status !== "cancelled",
    );
    const active = inEvent
      .filter((o) => o.status !== "completed")
      .sort((a, b) => {
        // Pinned (queuePriority set) first, sorted by descending pin time;
        // unpinned by submittedAt ascending.
        const ap = a.queuePriority ?? -Infinity;
        const bp = b.queuePriority ?? -Infinity;
        if (ap !== bp) return bp - ap;
        return a.submittedAt.localeCompare(b.submittedAt);
      });
    const completed = inEvent
      .filter((o) => o.status === "completed")
      .sort((a, b) => {
        // Newest completion first.
        const ad = a.doneAt ?? a.updatedAt;
        const bd = b.doneAt ?? b.updatedAt;
        return bd.localeCompare(ad);
      });
    return { active, completed };
  }, [event, state.orders]);

  const [completedOpen, setCompletedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Ping + flash detector for new active orders.
  const seenRef = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(active.map((o) => o.id));
      return;
    }
    const fresh: string[] = [];
    for (const o of active) {
      if (!seenRef.current.has(o.id)) {
        fresh.push(o.id);
        seenRef.current.add(o.id);
      }
    }
    if (fresh.length > 0) {
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
  }, [active, state.settings.baristaPingEnabled, state.settings.audioUnlocked]);

  if (!event || !snapshot) {
    return (
      <EmptyState
        title="No active event"
        description="Set an active event to see incoming orders."
      />
    );
  }

  const editingOrder = editingId
    ? [...active, ...completed].find((o) => o.id === editingId)
    : undefined;

  function pin(orderId: string, currentlyPinned: boolean) {
    dispatch({
      type: "UPDATE_ORDER",
      id: orderId,
      patch: { queuePriority: currentlyPinned ? undefined : Date.now() },
    });
  }

  function toggleItem(o: Order, itemId: string, currentStatus: OrderItemStatus) {
    dispatch({
      type: "SET_ORDER_ITEM_STATUS",
      orderId: o.id,
      orderItemId: itemId,
      status: currentStatus === "done" ? "pending" : "done",
    });
  }

  function setItemDiscount(orderId: string, itemId: string, pct: number) {
    dispatch({
      type: "UPDATE_ORDER_ITEM",
      orderId,
      orderItemId: itemId,
      patch: { discountPct: pct > 0 ? pct : undefined },
    });
  }

  function markComplete(o: Order) {
    dispatch({
      type: "UPDATE_ORDER",
      id: o.id,
      patch: {
        status: "completed",
        items: o.items.map((it) => ({ ...it, status: "done" })),
      },
    });
  }

  function reopen(o: Order) {
    dispatch({
      type: "UPDATE_ORDER",
      id: o.id,
      patch: {
        status: "pending",
        items: o.items.map((it) => ({ ...it, status: "pending" })),
        // Pin so it jumps to the top of active.
        queuePriority: Date.now(),
      },
    });
  }

  function remove(orderId: string, customer: string) {
    if (!confirm(`Remove order for ${customer}?`)) return;
    dispatch({ type: "DELETE_ORDER", id: orderId });
  }

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
              pinned={typeof o.queuePriority === "number"}
              onPin={() => pin(o.id, typeof o.queuePriority === "number")}
              onToggleItem={(itemId, status) => toggleItem(o, itemId, status)}
              onSetItemDiscount={(itemId, pct) => setItemDiscount(o.id, itemId, pct)}
              onMarkComplete={() => markComplete(o)}
              onEdit={() => setEditingId(o.id)}
              onRemove={() => remove(o.id, o.customerName)}
            />
          ))}
        </div>
      )}

      {completed.length > 0 ? (
        <section>
          <button
            onClick={() => setCompletedOpen((s) => !s)}
            className="t-display flex w-full items-center justify-between rounded-xl bg-cream-100 px-4 py-3 text-sm text-matcha-900/80 hover:bg-cream-200"
          >
            <span>Completed ({completed.length})</span>
            {completedOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {completedOpen ? (
            <div className="mt-3 space-y-2">
              {completed.map((o) => (
                <CompletedOrderCard
                  key={o.id}
                  order={o}
                  snapshot={snapshot}
                  onReopen={() => reopen(o)}
                  onEdit={() => setEditingId(o.id)}
                  onRemove={() => remove(o.id, o.customerName)}
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
  pinned,
  onPin,
  onToggleItem,
  onSetItemDiscount,
  onMarkComplete,
  onEdit,
  onRemove,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  fresh: boolean;
  pinned: boolean;
  onPin: () => void;
  onToggleItem: (itemId: string, status: OrderItemStatus) => void;
  onSetItemDiscount: (itemId: string, pct: number) => void;
  onMarkComplete: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  // Live timer — tick every 15s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const elapsed = minutesAgo(order.submittedAt, now);

  return (
    <Card
      className={cn(
        "transition-colors",
        fresh && "animate-flash border-matcha-300",
        pinned && "border-amber-300 bg-amber-50/30",
      )}
    >
      {/* Top row — name + timer on the left, buttons on the right. Wraps on
          mobile so the customer name never collides with the button stack. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="text-2xl font-semibold tabular-nums">#{order.orderNumber}</div>
            <div className="t-display truncate text-lg">{order.customerName}</div>
          </div>
          <div className="t-caption mt-0.5 text-xs text-matcha-900/60">
            {formatTime(order.submittedAt)} · {timerLabel(elapsed)}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={pinned ? "primary" : "outline"}
            onClick={onPin}
            title={pinned ? "Unpin" : "Bump to top"}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="primary" onClick={onMarkComplete}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark all done
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onRemove} title="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {order.items.map((it) => (
          <OrderItemRow
            key={it.id}
            item={it}
            snapshot={snapshot}
            interactive
            onToggle={() => onToggleItem(it.id, it.status)}
            onSetDiscount={(pct) => onSetItemDiscount(it.id, pct)}
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

function CompletedOrderCard({
  order,
  snapshot,
  onReopen,
  onEdit,
  onRemove,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  onReopen: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <Card className="opacity-80">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="text-base font-semibold tabular-nums">#{order.orderNumber}</div>
            <div className="t-display truncate text-sm">{order.customerName}</div>
          </div>
          <div className="t-caption mt-0.5 text-xs text-matcha-900/60">
            {formatTime(order.submittedAt)}
            {order.doneAt ? ` → done at ${formatTime(order.doneAt)}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={onReopen} title="Reopen">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onRemove} title="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {order.items.map((it) => (
          <OrderItemRow key={it.id} item={it} snapshot={snapshot} compact />
        ))}
      </div>
    </Card>
  );
}

function timerLabel(min: number): string {
  if (min < 1) return "just now";
  if (min === 1) return "1 min ago";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

function OrderItemRow({
  item,
  snapshot,
  interactive,
  compact,
  onToggle,
  onSetDiscount,
}: {
  item: OrderItem;
  snapshot: MenuSnapshot;
  interactive?: boolean;
  compact?: boolean;
  onToggle?: () => void;
  onSetDiscount?: (pct: number) => void;
}) {
  // Hook must run before any conditional return.
  const [discountOpen, setDiscountOpen] = useState(false);

  const displayName = item.isCombo
    ? `Combo: ${item.menuItemNameSnap} + ${item.comboPastryNameSnap ?? "?"}`
    : item.menuItemNameSnap;
  const done = item.status === "done";
  // priceSnap stores the un-discounted unit price (combo: COMBO_PRICE, else
  // the menu price). So it's the right base for the discount editor.
  const unitPrice = item.priceSnap;
  const pct = item.discountPct ?? 0;

  return (
    <div
      className={cn(
        "rounded-xl border border-cream-200 px-3 py-2",
        done && interactive && "bg-matcha-50/60 text-matcha-700 line-through",
        compact && "py-1.5",
      )}
    >
      <div className="flex items-start gap-3">
        {interactive ? (
          <button
            onClick={onToggle}
            aria-label={done ? "Mark as not done" : "Mark as done"}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
              done
                ? "border-matcha-500 bg-matcha-500 text-white"
                : "border-cream-300 bg-white hover:border-matcha-400",
            )}
          >
            {done ? <CheckCircle2 className="h-4 w-4" /> : null}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className={cn("t-display", compact ? "text-sm" : "text-base")}>
            {item.quantity}× {displayName}
          </div>
          <ItemModifiers item={item} snapshot={snapshot} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pct > 0 ? (
            <div className="t-caption text-right text-[11px] text-matcha-700">
              {pct === 100 ? "FREE" : `${pct}% off`}
            </div>
          ) : null}
          {interactive && onSetDiscount ? (
            <Button
              size="sm"
              variant={pct > 0 ? "primary" : "ghost"}
              onClick={() => setDiscountOpen((s) => !s)}
              title={pct > 0 ? "Edit discount" : "Add discount"}
            >
              <span className="t-display text-[11px]">%</span>
            </Button>
          ) : null}
        </div>
      </div>
      {discountOpen && onSetDiscount ? (
        <DiscountRow
          unitPrice={unitPrice}
          pct={pct}
          onPct={onSetDiscount}
          onClose={() => setDiscountOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ItemModifiers({
  item,
  snapshot,
}: {
  item: OrderItem;
  snapshot: MenuSnapshot;
}) {
  const drink = snapshot.menuItems.find((m) => m.id === item.menuItemId);
  const ingredients: Ingredient[] = snapshot.ingredients;

  const mods: string[] = [];

  // Always show the milk — fall back to the menu item's default if the
  // customer didn't pick one. This is what the barista actually needs.
  const milkId = item.milkChoiceId ?? drink?.defaultMilkId;
  if (milkId) {
    const milk = ingredients.find((i) => i.id === milkId);
    if (milk) mods.push(milk.name);
  }

  if (item.creamChoiceId === "none") {
    mods.push("no cream");
  } else {
    const creamId = item.creamChoiceId ?? drink?.defaultCreamId;
    if (creamId) {
      const cream = ingredients.find((i) => i.id === creamId);
      if (cream) mods.push(cream.name);
    }
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
