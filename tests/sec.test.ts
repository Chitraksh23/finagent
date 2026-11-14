import { afterEach, describe, expect, it, vi } from "vitest";
import { connectToolbox } from "../src/lib/mcp-client";
import { extractAnnual } from "../src/lib/sec";

const facts = {
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            { start: "2022-10-01", end: "2023-09-30", val: 383285000000, form: "10-K", fp: "FY", filed: "2023-11-03" },
            { start: "2023-07-02", end: "2023-09-30", val: 89498000000, form: "10-K", fp: "FY", filed: "2023-11-03" },
            { start: "2023-10-01", end: "2024-09-28", val: 391035000000, form: "10-K", fp: "FY", filed: "2024-11-01" },
            { start: "2024-01-01", end: "2024-03-30", val: 90753000000, form: "10-Q", fp: "Q2", filed: "2024-05-02" },
          ],
        },
      },
    },
  },
};

describe("extractAnnual", () => {
  it("keeps only full-year 10-K values, newest first", () => {
    const rows = extractAnnual(facts, "revenue", 5);
    expect(rows.map((r) => r.fiscal_year_end)).toEqual(["2024-09-28", "2023-09-30"]);
    expect(rows[0].value).toBe(391035000000);
  });
  it("rejects unknown metrics", () => {
    expect(() => extractAnnual(facts, "vibes", 1)).toThrow(/Unknown metric/);
  });
});

describe("MCP toolbox (in-memory transport)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes tools from both servers and executes them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }), { status: 200 }),
      ),
    );
    const box = await connectToolbox();
    expect(box.tools.map((t) => t.name).sort()).toEqual(
      ["calculate", "get_fundamentals", "get_quote", "list_filings", "search_company"].sort(),
    );

    const found = await box.call("search_company", { query: "AAPL" });
    expect(found.isError).toBe(false);
    expect(JSON.parse(found.text)[0]).toMatchObject({ cik: "0000320193", ticker: "AAPL" });

    const calc = await box.call("calculate", { operation: "pct_change", a: 100, b: 150 });
    expect(JSON.parse(calc.text).result).toBeCloseTo(50);

    const bad = await box.call("calculate", { operation: "pct_change", a: 0, b: 1 });
    expect(bad.isError).toBe(true);
    await box.close();
  });
});
