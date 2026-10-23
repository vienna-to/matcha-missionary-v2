import { describe, expect, it } from "vitest";
import { collabSplitFor, computeCollabSplit, isCollab, parseCollabInput } from "@/lib/collab-split";

describe("computeCollabSplit", () => {
  it("worked example: $500 revenue, $100 costs, 40% split, $50 contribution", () => {
    const s = computeCollabSplit(500 - 100, 40, 50);
    expect(s.profit).toBe(400);
    expect(s.partnerShare).toBeCloseTo(160, 10);
    expect(s.partnerTakeHome).toBeCloseTo(110, 10);
    expect(s.yourTakeHome).toBeCloseTo(290, 10);
  });

  it("the two take-homes always add up to the profit plus nothing else", () => {
    for (const [p, pct, c] of [[400, 40, 50], [123.45, 33, 7.5], [0, 50, 0], [999, 100, 999]]) {
      const s = computeCollabSplit(p, pct, c);
      expect(s.partnerTakeHome + s.yourTakeHome).toBeCloseTo(p, 9);
    }
  });

  it("no contribution: a plain percentage split", () => {
    const s = computeCollabSplit(200, 25, 0);
    expect(s.partnerTakeHome).toBe(50);
    expect(s.yourTakeHome).toBe(150);
  });

  it("contribution larger than the partner's share makes their take-home negative and yours larger than the profit", () => {
    const s = computeCollabSplit(100, 10, 40); // share 10, contribution 40
    expect(s.partnerTakeHome).toBeCloseTo(-30, 10);
    expect(s.yourTakeHome).toBeCloseTo(130, 10);
  });

  it("0% split: partner only gets their contribution back as a negative (you keep profit + contribution)", () => {
    const s = computeCollabSplit(300, 0, 20);
    expect(s.partnerTakeHome).toBe(-20);
    expect(s.yourTakeHome).toBe(320);
  });

  it("a loss is split by the same formula", () => {
    const s = computeCollabSplit(-100, 50, 0);
    expect(s.partnerTakeHome).toBe(-50);
    expect(s.yourTakeHome).toBe(-50);
  });
});

describe("collab on an event", () => {
  it("is a collab only when a split % or a contribution is set", () => {
    expect(isCollab({})).toBe(false);
    expect(isCollab({ collabProfitPct: 40 })).toBe(true);
    expect(isCollab({ collabContribution: 50 })).toBe(true);
    expect(isCollab({ collabProfitPct: 0 })).toBe(true); // an explicit 0% is still a collab
  });

  it("collabSplitFor is null for a normal event and treats a missing half as zero", () => {
    expect(collabSplitFor({}, 400)).toBeNull();
    expect(collabSplitFor({ collabProfitPct: 40 }, 400)?.partnerTakeHome).toBeCloseTo(160, 10);
    expect(collabSplitFor({ collabContribution: 50 }, 400)?.partnerTakeHome).toBe(-50);
    expect(collabSplitFor({ collabProfitPct: 40, collabContribution: 50 }, 400)?.yourTakeHome).toBeCloseTo(290, 10);
  });
});

describe("parseCollabInput", () => {
  it("blank means not set", () => {
    expect(parseCollabInput("  ", 0, 100)).toEqual({ ok: true, value: undefined });
  });
  it("accepts in-range numbers including the bounds", () => {
    expect(parseCollabInput("40", 0, 100)).toEqual({ ok: true, value: 40 });
    expect(parseCollabInput("0", 0, 100)).toEqual({ ok: true, value: 0 });
    expect(parseCollabInput("100", 0, 100)).toEqual({ ok: true, value: 100 });
    expect(parseCollabInput("12.5", 0, Infinity)).toEqual({ ok: true, value: 12.5 });
  });
  it("rejects out of range and non-numbers", () => {
    expect(parseCollabInput("101", 0, 100).ok).toBe(false);
    expect(parseCollabInput("-1", 0, 100).ok).toBe(false);
    expect(parseCollabInput("abc", 0, 100).ok).toBe(false);
    expect(parseCollabInput("-5", 0, Infinity).ok).toBe(false);
  });
});
