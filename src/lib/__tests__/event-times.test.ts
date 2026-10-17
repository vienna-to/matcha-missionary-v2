import { describe, expect, it } from "vitest";
import { END_BEFORE_START_MESSAGE, validateEventTimes } from "@/lib/event-times";
import { buildQuickAddEvent } from "@/lib/quick-add-event";
import { reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";

describe("event time validation", () => {
  it("accepts end after start, rejects end before or equal to start", () => {
    expect(validateEventTimes("11:00", "16:00")).toBeNull();
    expect(validateEventTimes("09:00", "09:01")).toBeNull();
    expect(validateEventTimes("16:00", "09:00")).toBe(END_BEFORE_START_MESSAGE);
    expect(validateEventTimes("11:00", "11:00")).toBe(END_BEFORE_START_MESSAGE);
  });
  it("does not judge empty values (the forms require both separately)", () => {
    expect(validateEventTimes("", "10:00")).toBeNull();
    expect(validateEventTimes("10:00", undefined)).toBeNull();
  });

  const base = { name: "E", date: "2026-10-16", eventType: "standard" as const, cupSizeOz: 16 };

  it("reducer CREATE_EVENT ignores an event that ends before it starts", () => {
    const s = initialSeed();
    const bad = reducer(s, { type: "CREATE_EVENT", event: { ...base, startTime: "16:00", endTime: "09:00" } });
    expect(bad).toBe(s);
    const ok = reducer(s, { type: "CREATE_EVENT", event: { ...base, startTime: "09:00", endTime: "16:00" } });
    expect(ok.events).toHaveLength(s.events.length + 1);
  });

  it("reducer UPDATE_EVENT ignores a time patch that would invert the window", () => {
    const s = initialSeed();
    const ev = s.events[0];
    expect(reducer(s, { type: "UPDATE_EVENT", id: ev.id, patch: { endTime: "01:00" } })).toBe(s);
    const moved = reducer(s, { type: "UPDATE_EVENT", id: ev.id, patch: { name: "Renamed" } });
    expect(moved.events[0].name).toBe("Renamed");
  });

  it("quick-add (past event) submit handler throws the same message", () => {
    expect(() =>
      buildQuickAddEvent({ state: initialSeed(), name: "Past", date: "2026-05-01", startTime: "18:00", endTime: "10:00", itemQuantities: { mi_classic: 1 } }),
    ).toThrow(END_BEFORE_START_MESSAGE);
  });
});
