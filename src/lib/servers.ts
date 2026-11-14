import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { calculate } from "./calc";
import { getQuote } from "./market";
import { METRICS, findCompany, getFundamentals, listFilings } from "./sec";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (e: unknown): ToolResult => ({
  content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});
const safe = async (fn: () => Promise<unknown>): Promise<ToolResult> => {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
};

/** MCP server 1: SEC EDGAR filings and structured fundamentals. */
export function createFilingsServer(): McpServer {
  const server = new McpServer({ name: "finagent-filings", version: "0.1.0" });

  server.registerTool(
    "search_company",
    {
      description: "Find a US-listed company's CIK by ticker (preferred, e.g. AAPL) or name fragment.",
      inputSchema: { query: z.string().min(1).describe("Ticker or company name") },
    },
    async ({ query }) => safe(() => findCompany(query)),
  );

  server.registerTool(
    "get_fundamentals",
    {
      description: `Annual (10-K) financials from SEC EDGAR XBRL, newest first. Metrics: ${METRICS.join(", ")}. Values are raw USD.`,
      inputSchema: {
        cik: z.string().describe("10-digit CIK from search_company"),
        metrics: z.array(z.enum(METRICS as [string, ...string[]])).min(1).max(6),
        years: z.number().int().min(1).max(6).default(3),
      },
    },
    async ({ cik, metrics, years }) => safe(() => getFundamentals(cik, metrics, years)),
  );

  server.registerTool(
    "list_filings",
    {
      description: "List recent SEC filings with links (e.g. form 10-K, 10-Q, 8-K).",
      inputSchema: {
        cik: z.string(),
        form: z.string().optional().describe("Filter by form type, e.g. 10-K"),
        limit: z.number().int().min(1).max(10).default(3),
      },
    },
    async ({ cik, form, limit }) => safe(() => listFilings(cik, form, limit)),
  );

  return server;
}

/** MCP server 2: delayed market quotes and a deterministic calculator (LLMs should not do arithmetic). */
export function createMarketServer(): McpServer {
  const server = new McpServer({ name: "finagent-market", version: "0.1.0" });

  server.registerTool(
    "get_quote",
    {
      description: "Delayed share price. US tickers as-is (AAPL); Indian stocks need a suffix (RELIANCE.NS, TCS.BO).",
      inputSchema: { symbol: z.string().min(1) },
    },
    async ({ symbol }) => safe(() => getQuote(symbol)),
  );

  server.registerTool(
    "calculate",
    {
      description:
        "Deterministic math. pct_change: (b-a)/|a|*100. cagr: needs years. margin: a/b*100. ratio: a/b. Always use this instead of computing yourself.",
      inputSchema: {
        operation: z.enum(["pct_change", "cagr", "margin", "ratio"]),
        a: z.number(),
        b: z.number(),
        years: z.number().positive().optional(),
      },
    },
    async ({ operation, a, b, years }) => safe(async () => calculate(operation, a, b, years)),
  );

  return server;
}
