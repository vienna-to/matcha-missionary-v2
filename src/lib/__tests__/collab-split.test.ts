import { describe, expect, it } from "vitest";
import { collabSplitFor, computeCollabSplit, isCollab, parseCollabFields, parseCollabInput } from "@/lib/collab-split";

describe("computeCollabSplit", () => {
  it("worked example: $500 revenue, $100 costs, 40% split, $50 contribution", () => {
    const s = computeCollabSplit(500 - 100, 40, 50);
    expect(s.profit).toBe(400);
    expect(s.partnerShare).toBeCloseTo(160, 10);
    expect(s.partnerTakeHome).toBeCloseTo(110, 10);
    expect(s.yourTakeHome).toBeCloseTo(290, 10);
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

const cents = (n: number) => Math.round(n * 100);

describe("the two take-homes always sum to the profit, to the cent", () => {
  const CASES: Array<[string, number, number, number]> = [
    ["profit 39.95 at 50% (a half cent)", 39.95, 50, 0],
    ["profit 39.95 at 50%, $10 contribution", 39.95, 50, 10],
    ["profit 39.95 at 40%, $6 contribution", 39.95, 40, 6],
    ["profit 39.95 at 33%", 39.95, 33, 0],
    ["profit with sub-cent noise 39.9537", 39.9537, 50, 0],
    ["profit 0.01 at 50%", 0.01, 50, 0],
    ["profit 0.03 at 50%", 0.03, 50, 0],
    ["profit 100 at 33.333%", 100, 33.333, 7.77],
    ["profit 12.35 at 12.5%", 12.35, 12.5, 0.1],
    ["profit 1234.56 at 7.5%", 1234.56, 7.5, 33.33],
    ["a loss, -39.95 at 50%", -39.95, 50, 0],
    ["contribution above the share", 39.95, 10, 20],
    ["100% split", 39.95, 100, 3],
  ];
  for (const [label, profit, pct, contribution] of CASES) {
    it(label, () => {
      const s = computeCollabSplit(profit, pct, contribution);
      // exact in whole cents: partner + yours === profit
      expect(cents(s.partnerTakeHome) + cents(s.yourTakeHome)).toBe(cents(s.profit));
      // and the profit shown is the real profit to the nearest cent
      expect(cents(s.profit)).toBe(Math.round(profit * 100));
      // the displayed lines agree with each other: share - contribution = partner
      expect(cents(s.partnerShare) - cents(s.contribution)).toBe(cents(s.partnerTakeHome));
      // your take-home is a subtraction from profit, not a percentage of anything
      expect(cents(s.yourTakeHome)).toBe(cents(s.profit) - cents(s.partnerTakeHome));
    });
  }

  it("the exact case from the screen: 39.95 profit never shows two take-homes that add to 39.94", () => {
    const s = computeCollabSplit(39.95, 50, 10);
    expect(s.partnerTakeHome).toBe(9.98);
    expect(s.yourTakeHome).toBe(29.97);
    expect(s.partnerTakeHome.toFixed(2)).toBe("9.98");
    expect(cents(s.partnerTakeHome) + cents(s.yourTakeHome)).toBe(3995);
  });

  it("half cents round away from zero (partner share of 19.975 is 19.98, and -19.975 is -19.98)", () => {
    expect(computeCollabSplit(39.95, 50, 0).partnerShare).toBe(19.98);
    expect(computeCollabSplit(-39.95, 50, 0).partnerShare).toBe(-19.98);
  });

  it("holds for thousands of arbitrary profits, percentages and contributions", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 5000; i++) {
      const profit = Math.round((rnd() * 2000 - 200) * 10000) / 10000; // includes sub-cent profits and losses
      const pct = Math.round(rnd() * 100000) / 1000; // 0 to 100, three decimals
      const contribution = Math.round(rnd() * 20000) / 100;
      const s = computeCollabSplit(profit, pct, contribution);
      expect(cents(s.partnerTakeHome) + cents(s.yourTakeHome)).toBe(cents(s.profit));
      expect(cents(s.partnerShare) - cents(s.contribution)).toBe(cents(s.partnerTakeHome));
    }
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

describe("parseCollabFields (shared by New Event, Quick add and the Event Summary panel)", () => {
  it("both blank: not a collab", () => {
    expect(parseCollabFields("", "  ")).toEqual({ ok: true, value: null });
  });
  it("both filled", () => {
    expect(parseCollabFields("40", "50")).toEqual({ ok: true, value: { collabProfitPct: 40, collabContribution: 50 } });
  });
  it("one blank half counts as 0", () => {
    expect(parseCollabFields("40", "")).toEqual({ ok: true, value: { collabProfitPct: 40, collabContribution: 0 } });
    expect(parseCollabFields("", "50")).toEqual({ ok: true, value: { collabProfitPct: 0, collabContribution: 50 } });
  });
  it("same validation as the panel: share 0 to 100, contribution 0 or more, numbers only", () => {
    expect(parseCollabFields("101", "")).toEqual({ ok: false, pctError: true, contributionError: false });
    expect(parseCollabFields("-1", "")).toEqual({ ok: false, pctError: true, contributionError: false });
    expect(parseCollabFields("40", "-5")).toEqual({ ok: false, pctError: false, contributionError: true });
    expect(parseCollabFields("abc", "x")).toEqual({ ok: false, pctError: true, contributionError: true });
    expect(parseCollabFields("0", "0")).toEqual({ ok: true, value: { collabProfitPct: 0, collabContribution: 0 } });
    expect(parseCollabFields("100", "12.5").ok).toBe(true);
  });
});

describe("an event created with the terms shows the same split the Event Summary panel computes", () => {
  it("terms set at creation drive collabSplitFor / computeCollabSplit; at $0 profit there are no dollar take-homes", () => {
    const parsed = parseCollabFields("40", "50");
    if (!parsed.ok || !parsed.value) throw new Error("expected terms");
    const created = { ...parsed.value };
    expect(isCollab(created)).toBe(true);
    expect(collabSplitFor(created, 400)).toEqual(computeCollabSplit(400, 40, 50));
    const empty = collabSplitFor(created, 0);
    expect(empty?.partnerShare).toBe(0);
    expect(empty?.partnerTakeHome).toBe(-50); // contribution agreed, nothing earned yet
  });
  it("an event created with the fields blank is not a collab", () => {
    expect(isCollab({})).toBe(false);
  });
});
