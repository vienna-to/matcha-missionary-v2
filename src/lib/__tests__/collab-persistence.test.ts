import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearSaveErrors, getSaveErrors } from "@/lib/supabase/save-errors";
import { fromEvent, toEventInsert, toEventPatch } from "@/lib/supabase/serialize";
import type { DbEvent } from "@/lib/supabase/serialize";
import { writer } from "@/lib/supabase/writer";
import type { Event, MenuSnapshot } from "@/lib/types";

const T = "2026-01-01T00:00:00.000Z";
const EVT: Event = {
  id: "e1", name: "Collab", date: "2026-05-01", startTime: "10:00", endTime: "14:00",
  menuSnapshotId: "e1", fixedCosts: [], isActive: false, createdAt: T, updatedAt: T,
};
const SNAP = { id: "e1", menuItems: [], ingredients: [] } as unknown as MenuSnapshot;

describe("collab fields in the database rows", () => {
  it("round trip: set values come back; nulls and absent columns are not a collab", () => {
    const row = { ...toEventInsert("w", { ...EVT, collabProfitPct: 40, collabContribution: 50 }, SNAP), created_at: T, updated_at: T } as DbEvent;
    expect(row.collab_profit_pct).toBe(40);
    expect(row.collab_contribution).toBe(50);
    const back = fromEvent(row);
    expect(back.collabProfitPct).toBe(40);
    expect(back.collabContribution).toBe(50);
    // numeric columns can arrive as strings
    expect(fromEvent({ ...row, collab_profit_pct: "12.5" as unknown as number }).collabProfitPct).toBe(12.5);
    expect(fromEvent({ ...row, collab_profit_pct: null, collab_contribution: null }).collabProfitPct).toBeUndefined();
    const legacy = fromEvent({ ...row, collab_profit_pct: undefined, collab_contribution: undefined });
    expect(legacy.collabProfitPct).toBeUndefined();
    expect(legacy.collabContribution).toBeUndefined();
  });

  it("creating an ordinary event never names the new columns (so it works before the migration)", () => {
    const row = toEventInsert("w", EVT, SNAP);
    expect("collab_profit_pct" in row).toBe(false);
    expect("collab_contribution" in row).toBe(false);
  });

  it("a patch that clears the split writes nulls; an unrelated patch does not touch them", () => {
    expect(toEventPatch({ collabProfitPct: undefined, collabContribution: undefined })).toEqual({
      collab_profit_pct: null,
      collab_contribution: null,
    });
    expect(toEventPatch({ name: "X" })).toEqual({ name: "X" });
    expect(toEventPatch({ donationPct: 10 })).toEqual({ donation_pct: 10 });
  });
});

/** An events table with or without the collab columns; records what was applied. */
function fakeDb(hasCollab: boolean) {
  const applied: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      update: (row: Record<string, unknown>) => {
        const bad = Object.keys(row).find((k) => !hasCollab && k.startsWith("collab_"));
        const error = bad ? { code: "PGRST204", message: `Could not find the '${bad}' column of 'events' in the schema cache` } : null;
        if (!error) applied.push(row);
        const chain = { eq: () => chain, then: (res: (v: unknown) => unknown) => Promise.resolve({ error }).then(res) };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, applied };
}

describe("saving a collab split", () => {
  beforeEach(() => clearSaveErrors());

  it("with the migration: saved, no error", async () => {
    const { client, applied } = fakeDb(true);
    await writer(client, "w").updateEvent("e1", { collabProfitPct: 40, collabContribution: 50 });
    expect(applied).toEqual([{ collab_profit_pct: 40, collab_contribution: 50 }]);
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("without the migration: says so and names the file; nothing else is lost", async () => {
    const { client, applied } = fakeDb(false);
    await writer(client, "w").updateEvent("e1", { collabProfitPct: 40, collabContribution: 50 });
    expect(applied).toEqual([]);
    expect(getSaveErrors().map((e) => e.message).join()).toContain("migration-add-collab-split.sql");
  });

  it("without the migration: an edit sent together with the split still saves", async () => {
    const { client, applied } = fakeDb(false);
    await writer(client, "w").updateEvent("e1", { notes: "hi", collabProfitPct: 40 });
    expect(applied).toEqual([{ notes: "hi" }]);
    expect(getSaveErrors()).toHaveLength(1);
  });

  it("without the migration: ordinary event edits are untouched (no error)", async () => {
    const { client, applied } = fakeDb(false);
    await writer(client, "w").updateEvent("e1", { name: "Renamed", donationPct: 10 });
    expect(applied).toEqual([{ name: "Renamed", donation_pct: 10 }]);
    expect(getSaveErrors()).toHaveLength(0);
  });
});
