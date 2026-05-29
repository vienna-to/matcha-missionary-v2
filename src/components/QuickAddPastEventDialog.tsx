"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Field,
  Input,
  Modal,
  NumberField,
  Textarea,
} from "@/components/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/supabase/client";
import { buildQuickAddEvent } from "@/lib/quick-add-event";
import {
  toEventInsert,
  toOrderInsert,
  toOrderItemInsert,
} from "@/lib/supabase/serialize";
import type { Action } from "@/lib/reducer";
import { formatMoney } from "@/lib/utils";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function QuickAddPastEventDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (eventId: string) => void;
}) {
  const { state, dispatch, backend, workspaceId } = useStore();

  // Past events can include sales of items that have since been archived,
  // so show every menu item — active first (in their Menu Manager order),
  // archived (greyed) below.
  const allMenu = useMemo(() => {
    const sorted = [...state.menuItems].sort(
      (a, b) =>
        (a.sortOrder ?? Number.POSITIVE_INFINITY) -
        (b.sortOrder ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
    return sorted.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  }, [state.menuItems]);

  const [name, setName] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState("11:00");
  const [endTime, setEndTime] = useState("16:00");
  const [donationPct, setDonationPct] = useState(0);
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCups = Object.values(qty).reduce((s, n) => s + (n || 0), 0);
  const grossRevenue = allMenu.reduce(
    (sum, mi) => sum + (qty[mi.id] ?? 0) * mi.price,
    0,
  );

  const valid =
    name.trim().length > 0 && date.length === 10 && totalCups > 0;

  function reset() {
    setName("");
    setDate(todayLocal());
    setStartTime("11:00");
    setEndTime("16:00");
    setDonationPct(0);
    setNotes("");
    setQty({});
  }

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const { event, snapshot, orders } = buildQuickAddEvent({
        state,
        name: name.trim(),
        date,
        startTime,
        endTime,
        notes,
        donationPct: donationPct > 0 ? donationPct : undefined,
        itemQuantities: qty,
      });

      if (backend === "supabase" && workspaceId) {
        const supabase = getClient();
        if (!supabase) throw new Error("supabase client missing");
        // Bulk insert in FK-safe order. Realtime will populate local state.
        const e1 = await supabase
          .from("events")
          .insert(toEventInsert(workspaceId, event, snapshot));
        if (e1.error) throw new Error(`events: ${e1.error.message}`);
        if (orders.length > 0) {
          const e2 = await supabase
            .from("orders")
            .insert(orders.map((o) => toOrderInsert(workspaceId, o)));
          if (e2.error) throw new Error(`orders: ${e2.error.message}`);
          const orderItems = orders.flatMap((o) => o.items);
          if (orderItems.length > 0) {
            const e3 = await supabase
              .from("order_items")
              .insert(orderItems.map((oi) => toOrderItemInsert(workspaceId, oi)));
            if (e3.error) throw new Error(`order_items: ${e3.error.message}`);
          }
        }
      } else {
        // Local mode: build the new state directly. Bypasses CREATE_EVENT's
        // single-active enforcement (we want isActive=false for a past event).
        const action: Action = {
          type: "REPLACE",
          state: {
            ...state,
            menuSnapshots: [...state.menuSnapshots, snapshot],
            events: [...state.events, event],
            orders: [...state.orders, ...orders],
          },
        };
        dispatch(action);
      }

      reset();
      onClose();
      onCreated?.(event.id);
    } catch (e: unknown) {
      setError((e as Error).message ?? "could not create event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Log past event">
      <div className="space-y-4">
        <p className="t-caption text-xs text-matcha-900/60">
          quickly record a finished event — costs come from your current ingredient prices.
          for fine-grained edits, use a live event instead.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="event name" className="col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. UCI Spring Pop-Up"
            />
          </Field>
          <Field label="date" className="col-span-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="start time">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="end time">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
          <Field label="donation % (optional)" className="col-span-2" hint="for charity events — % of revenue donated">
            <NumberField
              min={0}
              max={100}
              step={1}
              value={donationPct}
              commit="change"
              onChange={setDonationPct}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-cream-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="t-display text-sm">quantity sold per item</h4>
            <div className="t-caption text-xs text-matcha-900/60">
              {totalCups} cup{totalCups === 1 ? "" : "s"} · {formatMoney(grossRevenue)}
            </div>
          </div>
          {allMenu.length === 0 ? (
            <p className="t-caption text-xs text-matcha-900/60">
              no menu items yet. add some in menu manager first.
            </p>
          ) : (
            <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
              {allMenu.map((mi) => {
                const n = qty[mi.id] ?? 0;
                return (
                  <div
                    key={mi.id}
                    className="grid grid-cols-[1fr_70px_90px] items-center gap-2"
                  >
                    <div className="min-w-0">
                      <div className={`t-display truncate text-xs ${mi.active ? "" : "text-matcha-900/50"}`}>
                        {mi.name}
                        {!mi.active ? (
                          <span className="t-caption ml-1.5 text-[10px] text-matcha-900/40">
                            (archived)
                          </span>
                        ) : null}
                      </div>
                      <div className="t-caption text-[11px] text-matcha-900/50">
                        {formatMoney(mi.price)} each
                      </div>
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
                    <div className="text-right text-xs tabular-nums text-matcha-900/70">
                      {formatMoney(n * mi.price)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Field label="notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error ? (
          <div className="t-caption rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!valid || busy}>
            {busy ? "saving…" : "Create past event"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
