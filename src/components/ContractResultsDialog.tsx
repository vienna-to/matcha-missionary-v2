"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Field,
  Modal,
  NumberField,
} from "@/components/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/supabase/client";
import { computeItemCost } from "@/lib/calc";
import { newId } from "@/lib/id";
import type { Action } from "@/lib/reducer";
import {
  toEventInsert,
  toOrderInsert,
  toOrderItemInsert,
} from "@/lib/supabase/serialize";
import type { Event, Order, OrderItem } from "@/lib/types";

/**
 * Enter results for a Contract event — synthesizes one order per cup against
 * the event's frozen menu snapshot, stamping ingredient cost using the event's
 * cup size. Analogous to buildQuickAddEvent, but the event already exists and
 * we only append order rows.
 *
 * If the event already has orders, they're wiped first so a re-open + edit
 * doesn't double-count.
 */
export default function ContractResultsDialog({
  open,
  onClose,
  event,
}: {
  open: boolean;
  onClose: () => void;
  event: Event;
}) {
  const { state, dispatch, backend, workspaceId } = useStore();

  const snapshot = useMemo(
    () => state.menuSnapshots.find((s) => s.id === event.menuSnapshotId),
    [state.menuSnapshots, event.menuSnapshotId],
  );

  const existingOrders = useMemo(
    () => state.orders.filter((o) => o.eventId === event.id),
    [state.orders, event.id],
  );

  const drinks = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.menuItems]
      .filter((m) => m.size !== "pastry_count")
      .sort(
        (a, b) =>
          (a.sortOrder ?? Number.POSITIVE_INFINITY) -
            (b.sortOrder ?? Number.POSITIVE_INFINITY) ||
          a.name.localeCompare(b.name),
      );
  }, [snapshot]);

  // Seed the quantity map from existing synthetic orders so re-opening the
  // dialog shows what was previously entered (per-menuItem counts).
  const initialQty = useMemo(() => {
    const q: Record<string, number> = {};
    for (const o of existingOrders) {
      for (const it of o.items) {
        q[it.menuItemId] = (q[it.menuItemId] ?? 0) + it.quantity;
      }
    }
    return q;
  }, [existingOrders]);

  const [qty, setQty] = useState<Record<string, number>>(initialQty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCups = Object.values(qty).reduce((s, n) => s + (n || 0), 0);

  async function save() {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const startMs = makeDayTime(event.date, event.startTime, 11, 0).getTime();
      const endMs = makeDayTime(event.date, event.endTime, 16, 0).getTime();
      const window = Math.max(60_000, endMs - startMs);

      // Flatten quantities into one synthesized order per cup.
      const cupQueue: string[] = [];
      for (const [miId, n] of Object.entries(qty)) {
        const k = Math.max(0, Math.floor(n));
        for (let i = 0; i < k; i++) cupQueue.push(miId);
      }
      // Shuffle so timeline isn't clumped by drink.
      for (let i = cupQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cupQueue[i], cupQueue[j]] = [cupQueue[j], cupQueue[i]];
      }

      const itemById = new Map(snapshot.menuItems.map((m) => [m.id, m]));

      const newOrders: Order[] = cupQueue.map((miId, idx) => {
        const mi = itemById.get(miId);
        if (!mi) throw new Error(`unknown menu item id ${miId}`);
        const cost = computeItemCost(mi, snapshot.ingredients, {
          cupSizeOz: event.cupSizeOz,
        });
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
          paymentMethod: "cash",
          status: "completed",
          submittedAt,
          doneAt: submittedAt,
          updatedAt: submittedAt,
        };
      });

      if (backend === "supabase" && workspaceId) {
        const supabase = getClient();
        if (!supabase) throw new Error("supabase client missing");
        // The store mirrors CREATE_EVENT to Supabase via setTimeout(0) — it's
        // fire-and-forget, so when the user creates a Contract event and
        // immediately enters results, this order INSERT can beat the event
        // INSERT and blow up on the FK. Awaiting an idempotent upsert here
        // guarantees the event row exists before we reference it. When the
        // store's async createEvent eventually fires, it's a no-op (onConflict
        // ignoreDuplicates in writer.createEvent).
        const eup = await supabase
          .from("events")
          .upsert(toEventInsert(workspaceId, event, snapshot), {
            onConflict: "id",
            ignoreDuplicates: true,
          });
        if (eup.error) throw new Error(`events upsert: ${eup.error.message}`);
        // Wipe existing synthetic orders for this event so re-open + edit
        // replaces cleanly instead of stacking.
        if (existingOrders.length > 0) {
          const e0 = await supabase
            .from("orders")
            .delete()
            .eq("event_id", event.id);
          if (e0.error) throw new Error(`orders delete: ${e0.error.message}`);
        }
        if (newOrders.length > 0) {
          const e1 = await supabase
            .from("orders")
            .insert(newOrders.map((o) => toOrderInsert(workspaceId, o)));
          if (e1.error) throw new Error(`orders: ${e1.error.message}`);
          const orderItems = newOrders.flatMap((o) => o.items);
          if (orderItems.length > 0) {
            const e2 = await supabase
              .from("order_items")
              .insert(orderItems.map((oi) => toOrderItemInsert(workspaceId, oi)));
            if (e2.error) throw new Error(`order_items: ${e2.error.message}`);
          }
        }
      } else {
        // Local mode: replace this event's orders wholesale.
        const kept = state.orders.filter((o) => o.eventId !== event.id);
        const action: Action = {
          type: "REPLACE",
          state: { ...state, orders: [...kept, ...newOrders] },
        };
        dispatch(action);
      }

      onClose();
    } catch (e: unknown) {
      setError((e as Error).message ?? "could not save results");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return (
      <Modal open={open} onClose={onClose} title="Enter contract results">
        <p className="text-sm text-matcha-900/70">
          Missing menu snapshot for this event.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Enter contract results">
      <div className="space-y-4">
        <p className="t-caption text-xs text-matcha-900/60">
          Enter cups sold per drink for {event.name}. Ingredient cost stamped
          using {event.cupSizeOz ?? 16}oz cup size. Saving replaces any
          previously entered results.
        </p>

        <Field label={`quantity sold per drink · ${totalCups} cup${totalCups === 1 ? "" : "s"}`}>
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-cream-200 p-3">
            {drinks.length === 0 ? (
              <p className="t-caption text-xs text-matcha-900/60">
                no drink items in this event&apos;s menu snapshot.
              </p>
            ) : (
              drinks.map((mi) => {
                const n = qty[mi.id] ?? 0;
                return (
                  <div
                    key={mi.id}
                    className="grid grid-cols-[1fr_80px] items-center gap-2"
                  >
                    <div className="min-w-0">
                      <div className="t-display truncate text-xs">{mi.name}</div>
                    </div>
                    <NumberField
                      min={0}
                      step={1}
                      value={n}
                      commit="change"
                      onChange={(v) =>
                        setQty((q) => ({ ...q, [mi.id]: Math.max(0, Math.floor(v)) }))
                      }
                      className="h-8"
                    />
                  </div>
                );
              })
            )}
          </div>
        </Field>

        {error ? (
          <div className="t-caption rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "saving…" : "Save results"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function makeDayTime(date: string, hhmm: string, fallbackH: number, fallbackM: number): Date {
  const [hStr, mStr] = (hhmm || "").split(":");
  const h = Number.isFinite(Number(hStr)) ? Number(hStr) : fallbackH;
  const m = Number.isFinite(Number(mStr)) ? Number(mStr) : fallbackM;
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h, m, 0, 0);
}
