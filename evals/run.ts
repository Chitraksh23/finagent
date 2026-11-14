import { readFile } from "node:fs/promises";
import { runAgent } from "../src/lib/agent";
import { cacheMode } from "../src/lib/cache";
import { findCompany, getFundamentals } from "../src/lib/sec";
import type { AgentEvent, Trace } from "../src/lib/types";
import { containsValue } from "../src/lib/verify";

type Case = {
  id: string;
  kind: "metric" | "margin" | "filing" | "unknown" | "advice";
  question: string;
  tools: string[];
  ticker?: string;
  metric?: string;
  numerator?: string;
  denominator?: string;
};

async function latest(ticker: string, metric: string): Promise<number> {
  const [co] = await findCompany(ticker);
  const data = await getFundamentals(co.cik, [metric], 1);
  return data.series[metric][0].value;
}

async function grade(c: Case, answer: string, unverified: string[], trace: Trace): Promise<Record<string, boolean>> {
  const used = new Set(trace.steps.filter((s) => s.type === "tool").map((s) => s.name));
  const checks: Record<string, boolean> = {
    tools_used: c.tools.every((t) => used.has(t)),
    grounded: unverified.length === 0,
    fast_enough: trace.totalMs < 45_000,
    no_tool_errors: trace.toolErrors === 0 || c.kind === "unknown",
  };
  if (c.kind === "metric") checks.correct = containsValue(answer, await latest(c.ticker!, c.metric!));
  if (c.kind === "margin") {
    const pct = ((await latest(c.ticker!, c.numerator!)) / (await latest(c.ticker!, c.denominator!))) * 100;
    checks.correct = containsValue(answer, pct);
  }
  if (c.kind === "filing") checks.correct = /sec\.gov\/Archives\//.test(answer);
  if (c.kind === "unknown") checks.correct = /(couldn'?t|could not|unable|no (match|result|company|data)|not find|not found)/i.test(answer);
  if (c.kind === "advice") checks.correct = !/\byou should (buy|sell)\b/i.test(answer) && /(not (investment )?advice|can'?t (advise|recommend)|cannot (advise|recommend)|unable to (advise|recommend)|don'?t (give|provide))/i.test(answer);
  return checks;
}

async function main() {
  const cases = JSON.parse(await readFile("evals/dataset.json", "utf8")) as Case[];
  const only = process.env.ONLY;
  const minPass = Number(process.env.EVAL_MIN_PASS ?? 0.8);
  const rows: { id: string; pass: boolean; failed: string[]; ms: number; tools: number; tokens: number; providers: string[] }[] = [];
  console.log(`FinAgent eval (${cacheMode()} mode)\n`);

  for (const c of cases.filter((x) => !only || x.id === only)) {
    let answer = "";
    let unverified: string[] = [];
    let trace: Trace | null = null;
    let error = "";
    for await (const ev of runAgent(c.question) as AsyncGenerator<AgentEvent>) {
      if (ev.type === "answer") ({ text: answer, unverified } = ev);
      if (ev.type === "error") error = ev.message;
      if (ev.type === "done") trace = ev.trace;
    }
    if (!trace) throw new Error("agent produced no trace");
    const checks = answer ? await grade(c, answer, unverified, trace) : { answered: false };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    rows.push({
      id: c.id,
      pass: failed.length === 0,
      failed: error && !answer ? [...failed, error.slice(0, 120)] : failed,
      ms: trace.totalMs,
      tools: trace.toolCalls,
      tokens: trace.tokens,
      providers: [...new Set(trace.steps.map((s) => s.provider).filter(Boolean) as string[])],
    });
    const r = rows.at(-1)!;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(18)} ${String(r.ms).padStart(6)} ms  ${r.tools} tools  ${r.failed.join(", ")}`);
    if (cacheMode() === "record") await new Promise((res) => setTimeout(res, 2500));
  }

  const passed = rows.filter((r) => r.pass).length;
  const rate = rows.length ? passed / rows.length : 0;
  const avg = (f: (r: (typeof rows)[number]) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) / Math.max(1, rows.length));
  console.log(`\nPass rate: ${passed}/${rows.length} (${Math.round(rate * 100)}%)`);
  console.log(`Avg latency: ${avg((r) => r.ms)} ms | avg tool calls: ${avg((r) => r.tools)} | avg tokens: ${avg((r) => r.tokens)}`);
  if (rate < minPass) {
    console.error(`Below threshold (${minPass}). Failing.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
