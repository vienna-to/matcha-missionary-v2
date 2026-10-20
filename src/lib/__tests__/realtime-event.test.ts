import { describe, expect, it } from "vitest";
import { reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import { fromRealtimeEvent, type DbEvent } from "@/lib/supabase/serialize";
import type { AppState } from "@/lib/types";

/**
 * Regression: after "Make active" the Realtime UPDATE payload for the event
 * arrives WITHOUT its (large, out-of-line) menu_snapshot column. The event used
 * to be rebuilt with menuSnapshotId = its own id, so its snapshot lookup failed:
 * the sidebar card showed 0 orders and Event Summary fell back to "All Events"
 * until a reload.
 */
function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "E", date: "2026-10-16", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  const ev = s.events.find((e) => e.name === "E")!;
  return { s, ev };
}

// What Realtime sends for an UPDATE of the events row: no menu_snapshot, no fixed_costs.
function updatePayload(ev: ReturnType<typeof setup>["ev"], isActive: boolean) {
  return {
    id: ev.id,
    workspace_id: "w",
    name: ev.name,
    date: ev.date,
    start_time: ev.startTime,
    end_time: ev.endTime,
    target_revenue: null,
    donation_pct: null,
    is_active: isActive,
    kind: ev.kind,
    event_type: ev.eventType,
    cup_size_oz: null,
    client_name: null,
    contract_payout: null,
    city: null,
    admission_charged: null,
    notes: null,
    created_at: ev.createdAt,
    updated_at: "2026-10-17T00:00:00.000Z",
  } as unknown as DbEvent;
}

describe("Realtime event UPDATE without the large jsonb columns", () => {
  it("keeps the event's snapshot link and fixed costs", () => {
    const { ev } = setup();
    const withCosts = {
      ...ev,
      fixedCosts: [{ id: "f", name: "Table", amount: 25, allocationMethod: "spread_evenly" as const }],
    };
    const evt = fromRealtimeEvent(updatePayload(withCosts, true), withCosts);
    expect(evt.menuSnapshotId).toBe(ev.menuSnapshotId);
    expect(evt.menuSnapshotId).not.toBe(ev.id);
    expect(evt.fixedCosts).toEqual(withCosts.fixedCosts);
  });

  it("an INSERT payload (full row) still uses the snapshot in the row", () => {
    const { ev, s } = setup();
    const snap = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    const full = { ...updatePayload(ev, true), menu_snapshot: snap, fixed_costs: [] } as unknown as DbEvent;
    expect(fromRealtimeEvent(full).menuSnapshotId).toBe(snap.id);
  });

  it("after the reducer applies it, the activated event still resolves its snapshot", () => {
    const { s, ev } = setup();
    const other = reducer(s, {
      type: "CREATE_EVENT",
      event: { name: "Other", date: "2026-10-17", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
    });
    const old = other.events.find((e) => e.name === "E")!;
    expect(old.isActive).toBe(false);
    // Make active on E arrives as an UPDATE with no snapshot column
    const next = reducer(other, {
      type: "RT_UPSERT_EVENT",
      event: fromRealtimeEvent(updatePayload(old, true), old),
    });
    const active = next.events.find((e) => e.isActive)!;
    expect(active.name).toBe("E");
    expect(next.events.filter((e) => e.isActive)).toHaveLength(1);
    expect(next.menuSnapshots.find((m) => m.id === active.menuSnapshotId)).toBeTruthy();
    void ev;
  });
});
