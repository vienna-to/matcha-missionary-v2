"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Hand,
  Pencil,
  Play,
  RotateCcw,
  StickyNote,
  Trash2,
  Volume2,
} from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import { DiscountRow } from "@/components/DiscountRow";
import { useActiveEvent, useStore } from "@/lib/store";
import { useHelperMode } from "@/lib/helper-mode";
import { lineList, lineRevenue, listUnit } from "@/lib/pricing";
import { playPing, unlockAudio } from "@/lib/audio";
import { cn, formatMoney, formatTime, minutesAgo } from "@/lib/utils";
import {
  hasDrinkAdjustments,
  itemDrinkName,
  orderCardIssue,
  resolveCreamName,
  resolveMilkName,
} from "@/lib/order-labels";
import type {
  FreeReason,
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
  const [helperMode] = useHelperMode();
  const snapshot = event
    ? state.menuSnapshots.find((s) => s.id === event.menuSnapshotId)
    : undefined;

  // Two buckets: active (pending / in_progress) on top, completed at the bottom.
  // Legacy "cancelled" orders are hidden (we removed that state).
  const { active, completed } = useMemo(() => {
    if (!event) return { active: [] as Order[], completed: [] as Order[] };
    const inEvent = state.orders.filter(
      (o) => o.eventId === event.id && o.status !== "cancelled",
    );
    const parseTime = (s: string) => {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : 0;
    };
    const active = inEvent
      .filter((o) => o.status !== "completed")
      .sort((a, b) => {
        // Pinned (queuePriority set) first, sorted by descending pin time.
        // Unpinned: strict chronological by submittedAt with orderNumber as a
        // deterministic tie-breaker — two rapid submits can share a
        // millisecond timestamp, and localeCompare on ISO strings can misorder
        // legacy rows that lack the ".SSS" milliseconds fragment.
        const ap = a.queuePriority ?? -Infinity;
        const bp = b.queuePriority ?? -Infinity;
        if (ap !== bp) return bp - ap;
        const at = parseTime(a.submittedAt);
        const bt = parseTime(b.submittedAt);
        if (at !== bt) return at - bt;
        return a.orderNumber - b.orderNumber;
      });
    const completed = inEvent
      .filter((o) => o.status === "completed")
      .sort((a, b) => {
        // Newest completion first.
        const ad = parseTime(a.doneAt ?? a.updatedAt);
        const bd = parseTime(b.doneAt ?? b.updatedAt);
        return bd - ad;
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

  function setItemFreeReason(orderId: string, itemId: string, reason: FreeReason | undefined) {
    dispatch({
      type: "UPDATE_ORDER_ITEM",
      orderId,
      orderItemId: itemId,
      patch: { freeReason: reason },
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

  function claim(o: Order) {
    // Flip pending → in_progress so anyone else at the booth can see it's
    // being made and doesn't duplicate the drink.
    dispatch({
      type: "UPDATE_ORDER",
      id: o.id,
      patch: { status: "in_progress" },
    });
  }

  function release(o: Order) {
    // Back to pending so a different barista can grab it.
    dispatch({
      type: "UPDATE_ORDER",
      id: o.id,
      patch: { status: "pending" },
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
              // Helpers can toggle item status + mark done, but not touch prices.
              onSetItemDiscount={
                helperMode
                  ? undefined
                  : (itemId, pct) => setItemDiscount(o.id, itemId, pct)
              }
              onSetItemFreeReason={
                helperMode
                  ? undefined
                  : (itemId, reason) => setItemFreeReason(o.id, itemId, reason)
              }
              onMarkComplete={() => markComplete(o)}
              onClaim={() => claim(o)}
              onRelease={() => release(o)}
              onEdit={() => setEditingId(o.id)}
              onRemove={() => remove(o.id, o.customerName)}
              helperMode={helperMode}
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
                  helperMode={helperMode}
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

/**
 * Guards a barista card against missing item data. If the order has no items
 * (or an item has no usable drink name) we re-read it from the server a few
 * times. "loading" = still trying; "missing" = gave up, show the red warning.
 * A card is never rendered blank.
 */
function useOrderItemRecovery(
  order: Order,
  snapshot: MenuSnapshot,
): "ok" | "loading" | "partial" | "missing" {
  const { refreshOrder } = useStore();
  const issue = orderCardIssue(order, snapshot);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (issue === "ok") {
      setGaveUp(false);
      return;
    }
    if (!refreshOrder) {
      setGaveUp(true);
      return;
    }
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 3 && !cancelled; i++) {
        if (await refreshOrder(order.id)) return;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setGaveUp(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [issue, order.id, refreshOrder]);

  if (issue === "ok") return "ok";
  if (issue === "partial") return "partial";
  return gaveUp ? "missing" : "loading";
}

function ItemDataMissing({ orderNumber, compact }: { orderNumber: number; compact?: boolean }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 rounded-xl border-2 border-red-500 bg-red-50 px-3 font-semibold text-red-700",
        compact ? "py-1.5 text-xs" : "py-3 text-sm",
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      ITEM DATA MISSING – check order #{orderNumber}
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
  onSetItemFreeReason,
  onMarkComplete,
  onClaim,
  onRelease,
  onEdit,
  onRemove,
  helperMode,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  fresh: boolean;
  pinned: boolean;
  onPin: () => void;
  onToggleItem: (itemId: string, status: OrderItemStatus) => void;
  onSetItemDiscount?: (itemId: string, pct: number) => void;
  onSetItemFreeReason?: (itemId: string, reason: FreeReason | undefined) => void;
  onMarkComplete: () => void;
  onClaim: () => void;
  onRelease: () => void;
  onEdit: () => void;
  onRemove: () => void;
  helperMode: boolean;
}) {
  // Live timer — tick every 15s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const recovery = useOrderItemRecovery(order, snapshot);
  const elapsed = minutesAgo(order.submittedAt, now);
  const { total, totalGross } = computeOrderTotals(order);
  const totalDiscount = totalGross - total;
  const inProgress = order.status === "in_progress";

  return (
    <Card
      className={cn(
        "transition-colors",
        fresh && "animate-flash border-matcha-300",
        pinned && "border-amber-300 bg-amber-50/30",
        // In-progress overrides pinned styling so a claimed order always
        // reads as "someone's on it" first, then "pinned" second.
        inProgress && "border-2 border-sky-400 bg-sky-50/60",
      )}
    >
      {inProgress ? (
        <div className="mb-2 flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900">
          <Hand className="h-3.5 w-3.5" />
          IN PROGRESS · someone at the booth is making this
        </div>
      ) : null}
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
          {inProgress ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onRelease}
              title="Someone else can take this"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Release
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onClaim}>
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          )}
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

      {/* Notes surface immediately under the header so the barista sees
          them when scanning, without scrolling past the items list. The
          actual note text is the dominant element — no "NOTE" header to
          compete for attention. */}
      {order.notes ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="min-w-0 whitespace-pre-wrap break-words">{order.notes}</div>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {recovery === "loading" ? (
          <div className="t-caption rounded-xl border border-dashed border-cream-300 px-3 py-3 text-sm text-matcha-900/60">
            loading order items…
          </div>
        ) : recovery === "missing" ? (
          <ItemDataMissing orderNumber={order.orderNumber} />
        ) : (
          order.items.map((it) => (
            <OrderItemRow
              key={it.id}
              item={it}
              snapshot={snapshot}
              orderNumber={order.orderNumber}
              interactive
              onToggle={() => onToggleItem(it.id, it.status)}
              onSetDiscount={
                onSetItemDiscount ? (pct) => onSetItemDiscount(it.id, pct) : undefined
              }
              onSetFreeReason={
                onSetItemFreeReason ? (r) => onSetItemFreeReason(it.id, r) : undefined
              }
              hidePrice={helperMode}
            />
          ))
        )}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-matcha-50 px-3 py-2">
        <div className="t-display text-[11px] text-matcha-700">Order total</div>
        <div className="text-right">
          <div className="text-base font-semibold tabular-nums text-matcha-900">
            {formatMoney(total)}
          </div>
          {/* Discount origin is hidden for helpers — they see the final total
              only, no "−$X discount" breakdown. */}
          {totalDiscount > 0 && !helperMode ? (
            <div className="t-caption text-[11px] text-matcha-700">
              −{formatMoney(totalDiscount)} discount
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function CompletedOrderCard({
  order,
  snapshot,
  onReopen,
  onEdit,
  onRemove,
  helperMode,
}: {
  order: Order;
  snapshot: MenuSnapshot;
  onReopen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  helperMode: boolean;
}) {
  const recovery = useOrderItemRecovery(order, snapshot);
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

      {order.notes ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <div className="min-w-0 whitespace-pre-wrap break-words">{order.notes}</div>
        </div>
      ) : null}

      <div className="mt-2 space-y-1">
        {recovery === "loading" ? (
          <div className="t-caption text-xs text-matcha-900/60">loading order items…</div>
        ) : recovery === "missing" ? (
          <ItemDataMissing orderNumber={order.orderNumber} compact />
        ) : (
          order.items.map((it) => (
            <OrderItemRow
              key={it.id}
              item={it}
              snapshot={snapshot}
              orderNumber={order.orderNumber}
              compact
              hidePrice={helperMode}
            />
          ))
        )}
      </div>

      <div className="t-caption mt-2 flex items-center justify-between text-xs text-matcha-900/70">
        <span>Total</span>
        <span className="tabular-nums">
          {formatMoney(computeOrderTotals(order).total)}
        </span>
      </div>
    </Card>
  );
}

/** Live order total — accounts for combo bundle price and per-item discount.
 *  Reads `priceSnap` (= original unit price for both combos and singles). */
function computeOrderTotals(order: Order): { total: number; totalGross: number } {
  let total = 0;
  let totalGross = 0;
  for (const it of order.items) {
    total += lineRevenue(it);
    totalGross += lineList(it);
  }
  return { total, totalGross };
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
  orderNumber,
  interactive,
  compact,
  onToggle,
  onSetDiscount,
  onSetFreeReason,
  hidePrice,
}: {
  item: OrderItem;
  snapshot: MenuSnapshot;
  orderNumber: number;
  interactive?: boolean;
  compact?: boolean;
  onToggle?: () => void;
  onSetDiscount?: (pct: number) => void;
  onSetFreeReason?: (reason: FreeReason | undefined) => void;
  /** Suppress the FREE / % off text next to the item (helper mode). */
  hidePrice?: boolean;
}) {
  // Hook must run before any conditional return.
  const [discountOpen, setDiscountOpen] = useState(false);

  const drinkName = itemDrinkName(item, snapshot);
  // No usable drink name anywhere: never render a blank row.
  if (drinkName === null) {
    return <ItemDataMissing orderNumber={orderNumber} compact={compact} />;
  }
  const displayName = item.isCombo
    ? `Combo: ${drinkName} + ${item.comboPastryNameSnap ?? "?"}`
    : drinkName;
  const done = item.status === "done";
  // priceSnap stores the un-discounted unit price (combo: COMBO_PRICE, else
  // the menu price). So it's the right base for the discount editor.
  const unitPrice = listUnit(item);
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
          {pct > 0 && !hidePrice ? (
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
          freeReason={item.freeReason}
          onFreeReason={onSetFreeReason}
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
  // Pastries show only their special request: no milk / cream / sugar / ice.
  const drinkOptions = hasDrinkAdjustments(drink);

  // Always show the milk — fall back to the menu item's default if the
  // customer didn't pick one. This is what the barista actually needs.
  // Names snapshotted at order time win; the ingredient lookup is only a
  // fallback for orders placed before snapshots existed.
  const milkName =
    item.milkNameSnap ?? resolveMilkName(item.milkChoiceId, drink, ingredients);
  if (drinkOptions && milkName) mods.push(milkName);

  const creamName =
    item.creamNameSnap ?? resolveCreamName(item.creamChoiceId, drink, ingredients);
  if (drinkOptions && creamName) mods.push(creamName);

  if (drinkOptions && item.sugarAdjustment && item.sugarAdjustment !== "normal") {
    mods.push(
      item.sugarAdjustment === "less"
        ? "less sweet"
        : item.sugarAdjustment === "extra"
        ? "extra sweet"
        : "no agave",
    );
  }
  if (drinkOptions && item.iceAdjustment && item.iceAdjustment !== "normal") {
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
