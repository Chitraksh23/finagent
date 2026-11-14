import { cached } from "./cache";

const UA = () => process.env.SEC_USER_AGENT ?? "FinAgent-demo contact@example.com";

async function secGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA(), Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`SEC request failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
}

export type Company = { cik: string; ticker: string; name: string };

export async function findCompany(query: string): Promise<Company[]> {
  return cached("sec", { fn: "findCompany", query: query.trim().toLowerCase() }, async () => {
    const map = await secGet<Record<string, { cik_str: number; ticker: string; title: string }>>(
      "https://www.sec.gov/files/company_tickers.json",
    );
    const q = query.trim().toLowerCase();
    const all = Object.values(map);
    const exact = all.find((c) => c.ticker.toLowerCase() === q);
    const hits = exact ? [exact] : all.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 5);
    return hits.map((c) => ({ cik: String(c.cik_str).padStart(10, "0"), ticker: c.ticker, name: c.title }));
  });
}

type Fact = { start?: string; end: string; val: number; form: string; fp: string; filed: string };
const CONCEPTS: Record<string, { tags: string[]; unit: string; flow: boolean }> = {
  revenue: {
    tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"],
    unit: "USD",
    flow: true,
  },
  net_income: { tags: ["NetIncomeLoss"], unit: "USD", flow: true },
  operating_income: { tags: ["OperatingIncomeLoss"], unit: "USD", flow: true },
  gross_profit: { tags: ["GrossProfit"], unit: "USD", flow: true },
  operating_cash_flow: { tags: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD", flow: true },
  total_assets: { tags: ["Assets"], unit: "USD", flow: false },
  total_liabilities: { tags: ["Liabilities"], unit: "USD", flow: false },
  diluted_eps: { tags: ["EarningsPerShareDiluted"], unit: "USD/shares", flow: true },
};
export const METRICS = Object.keys(CONCEPTS);

export type AnnualPoint = { fiscal_year_end: string; value: number; filed: string; form: string };

/** Pure: pull annual (10-K, full-year) values for one metric out of an EDGAR companyfacts payload. */
export function extractAnnual(
  facts: { facts?: Record<string, Record<string, { units?: Record<string, Fact[]> }>> },
  metric: string,
  years: number,
): AnnualPoint[] {
  const spec = CONCEPTS[metric];
  if (!spec) throw new Error(`Unknown metric "${metric}". Valid: ${METRICS.join(", ")}`);
  const byEnd = new Map<string, AnnualPoint>();
  for (const tag of spec.tags) {
    const rows = facts.facts?.["us-gaap"]?.[tag]?.units?.[spec.unit] ?? [];
    for (const r of rows) {
      if (r.form !== "10-K" || r.fp !== "FY") continue;
      if (spec.flow) {
        if (!r.start) continue;
        const days = (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000;
        if (days < 340 || days > 380) continue;
      }
      const prev = byEnd.get(r.end);
      if (!prev || r.filed > prev.filed) {
        byEnd.set(r.end, { fiscal_year_end: r.end, value: r.val, filed: r.filed, form: r.form });
      }
    }
  }
  return [...byEnd.values()].sort((a, b) => b.fiscal_year_end.localeCompare(a.fiscal_year_end)).slice(0, years);
}

export async function getFundamentals(cik: string, metrics: string[], years: number) {
  const id = cik.replace(/\D/g, "").padStart(10, "0");
  return cached("sec", { fn: "getFundamentals", id, metrics, years }, async () => {
    const data = await secGet<{ entityName?: string }>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`);
    const series: Record<string, AnnualPoint[]> = {};
    for (const m of metrics) series[m] = extractAnnual(data as never, m, years);
    return { entity: data.entityName ?? id, cik: id, unit_note: "USD (EPS in USD/share); source: SEC EDGAR XBRL, 10-K annual values", series };
  });
}

export async function listFilings(cik: string, form: string | undefined, limit: number) {
  const id = cik.replace(/\D/g, "").padStart(10, "0");
  return cached("sec", { fn: "listFilings", id, form, limit }, async () => {
    const data = await secGet<{
      filings: { recent: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } };
    }>(`https://data.sec.gov/submissions/CIK${id}.json`);
    const r = data.filings.recent;
    const out: { form: string; filed: string; url: string }[] = [];
    for (let i = 0; i < r.form.length && out.length < limit; i++) {
      if (form && r.form[i] !== form) continue;
      const acc = r.accessionNumber[i].replace(/-/g, "");
      out.push({
        form: r.form[i],
        filed: r.filingDate[i],
        url: `https://www.sec.gov/Archives/edgar/data/${Number(id)}/${acc}/${r.primaryDocument[i]}`,
      });
    }
    return out;
  });
}
