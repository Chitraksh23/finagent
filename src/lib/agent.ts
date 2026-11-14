import { randomUUID } from "node:crypto";
import { complete as defaultComplete, type ChatMsg, type CompleteFn } from "./llm";
import { connectToolbox, type ToolBox } from "./mcp-client";
import type { AgentEvent, TraceStep } from "./types";
import { findUnverified } from "./verify";

export const SYSTEM_PROMPT = `You are FinAgent, a research analyst for US-listed public companies.
Rules:
- Every number you state must come from a tool result. Never recall figures from memory.
- Find the company with search_company first, then get_fundamentals / list_filings / get_quote.
- Never do arithmetic yourself: use calculate for growth, margins, ratios and CAGR.
- Cite the source for each figure, e.g. "(10-K, FY ended 2024-09-28)".
- If a tool fails or data is missing, say so plainly. Do not guess.
- You provide research, not investment advice. If asked whether to buy or sell, decline and offer the underlying facts instead.
- Keep answers under 180 words. Money in USD, rounded sensibly.`;

export type AgentDeps = {
  complete?: CompleteFn;
  toolbox?: ToolBox;
  maxSteps?: number;
  deadlineMs?: number;
};

const MAX_TOOL_OUTPUT = 6000;

export async function* runAgent(question: string, deps: AgentDeps = {}): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const complete = deps.complete ?? defaultComplete;
  const maxSteps = deps.maxSteps ?? 6;
  const deadline = started + (deps.deadlineMs ?? 50_000);
  const toolbox = deps.toolbox ?? (await connectToolbox());
  const steps: TraceStep[] = [];
  const toolOutputs: string[] = [];
  let tokens = 0;

  const messages: ChatMsg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];

  const finish = (): AgentEvent => ({
    type: "done",
    trace: {
      runId: randomUUID(),
      question,
      steps,
      totalMs: Date.now() - started,
      llmCalls: steps.filter((s) => s.type === "llm").length,
      toolCalls: steps.filter((s) => s.type === "tool").length,
      toolErrors: steps.filter((s) => s.type === "tool" && !s.ok).length,
      tokens,
    },
  });

  try {
    for (let i = 0; i < maxSteps; i++) {
      if (Date.now() > deadline) {
        yield { type: "error", message: "Stopped: time budget reached before the agent finished." };
        yield finish();
        return;
      }

      const res = await complete(messages, toolbox.tools);
      tokens += res.tokens;
      const llmStep: TraceStep = { type: "llm", name: "model", ms: res.ms, ok: true, provider: res.provider, model: res.model, tokens: res.tokens };
      steps.push(llmStep);
      yield { type: "step", step: llmStep };

      const calls = (res.message.tool_calls ?? []).filter((c) => c.type === "function");
      if (calls.length === 0) {
        const text = (res.message.content ?? "").trim();
        yield { type: "answer", text, unverified: findUnverified(text, toolOutputs) };
        yield finish();
        return;
      }

      messages.push(res.message as ChatMsg);
      const results = await Promise.all(
        calls.map(async (c) => {
          const t0 = Date.now();
          let args: Record<string, unknown> = {};
          let out = { text: "", isError: false };
          try {
            args = JSON.parse(c.function.arguments || "{}");
            out = await toolbox.call(c.function.name, args);
          } catch (e) {
            out = { text: `Error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
          }
          const step: TraceStep = {
            type: "tool",
            name: c.function.name,
            ms: Date.now() - t0,
            ok: !out.isError,
            detail: JSON.stringify(args).slice(0, 140),
          };
          return { c, out, step };
        }),
      );

      for (const { c, out, step } of results) {
        steps.push(step);
        yield { type: "step", step };
        const text = out.text.slice(0, MAX_TOOL_OUTPUT);
        toolOutputs.push(text);
        messages.push({ role: "tool", tool_call_id: c.id, content: text });
      }
    }

    yield { type: "error", message: `Stopped: step limit (${maxSteps}) reached without a final answer.` };
    yield finish();
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
    yield finish();
  } finally {
    if (!deps.toolbox) await toolbox.close().catch(() => undefined);
  }
}
