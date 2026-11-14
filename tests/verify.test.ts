import { describe, expect, it } from "vitest";
import { calculate } from "../src/lib/calc";
import { containsValue, findUnverified } from "../src/lib/verify";

describe("findUnverified", () => {
  const tool = [JSON.stringify({ series: { revenue: [{ value: 383285000000 }, { value: 394328000000 }] } }), '{"result":2.8}'];

  it("accepts rounded figures that match tool output", () => {
    expect(findUnverified("Revenue was $383.3 billion (FY2023), up 2.8%.", tool)).toEqual([]);
  });

  it("flags figures no tool returned", () => {
    expect(findUnverified("Revenue was $500 billion.", tool)).toEqual(["$500 billion"]);
  });

  it("ignores years and small counts", () => {
    expect(findUnverified("In FY2023 there were 3 segments.", tool)).toEqual([]);
  });

  it("checks percentages against tool numbers", () => {
    expect(findUnverified("Growth was 9.9%.", tool)).toEqual(["9.9%"]);
  });
});

describe("containsValue", () => {
  it("matches within the answer's own rounding", () => {
    expect(containsValue("about $383 billion", 383285000000)).toBe(true);
    expect(containsValue("about $390 billion", 383285000000)).toBe(false);
  });
});

describe("calculate", () => {
  it("computes pct_change, margin and cagr", () => {
    expect(calculate("pct_change", 100, 110).result).toBeCloseTo(10);
    expect(calculate("margin", 25, 100).result).toBeCloseTo(25);
    expect(calculate("cagr", 100, 121, 2).result).toBeCloseTo(10);
  });
  it("rejects invalid input", () => {
    expect(() => calculate("pct_change", 0, 5)).toThrow();
    expect(() => calculate("cagr", 100, 121)).toThrow();
  });
});
