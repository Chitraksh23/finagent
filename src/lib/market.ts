import { cached } from "./cache";

export type Quote = {
  symbol: string;
  name?: string;
  price: number;
  currency: string;
  previous_close?: number;
  exchange?: string;
  as_of: string;
};

/** Delayed public quote. Works for US tickers (AAPL) and NSE/BSE via Yahoo suffixes (RELIANCE.NS, TCS.BO). */
export async function getQuote(symbol: string): Promise<Quote> {
  return cached("market", { fn: "getQuote", symbol }, async () => {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0 (FinAgent)" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`Quote lookup failed (${res.status}) for ${symbol}`);
    const json = (await res.json()) as {
      chart?: { result?: { meta: Record<string, unknown> }[] };
    };
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") throw new Error(`No quote data for ${symbol}`);
    return {
      symbol: String(meta.symbol ?? symbol),
      name: (meta.longName ?? meta.shortName) as string | undefined,
      price: meta.regularMarketPrice,
      currency: String(meta.currency ?? "USD"),
      previous_close: meta.chartPreviousClose as number | undefined,
      exchange: meta.exchangeName as string | undefined,
      as_of: new Date(Number(meta.regularMarketTime ?? 0) * 1000).toISOString(),
    };
  });
}
