import { describe, expect, it } from "vitest";
import { runAgent } from "../src/lib/agent";
import type { CompleteFn } from "../src/lib/llm";
import type { ToolBox } from "../src/lib/mcp-client";
import type { AgentEvent } from "../src/lib/types";

const toolbox: ToolBox = {
  tools: [{ name: "get_fundamentals", description: "", parameters: { type: "object" } }],
  call: async () => ({ text: '{"series":{"revenue":[{"value":383285000000}]}}', isError: false }),
  close: async () => undefined,
};

const toolCall = {
  role: "assistant",
  content: null,
  refusal: null,
  tool_calls: [{ id: "c1", type: "function", function: { name: "get_fundamentals", arguments: '{"cik":"1"}' } }],
};

const reply = (message: object): ReturnType<CompleteFn> =>
  Promise.resolve({ message: message as never, provider: "stub", model: "stub", tokens: 10, ms: 5 });

async function collect(gen: AsyncGenerator<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("runAgent", () => {
  it("runs a tool call, answers, and verifies figures", async () => {
    let n = 0;
    const complete: CompleteFn = () =>
      n++ === 0 ? reply(toolCall) : reply({ role: "assistant", content: "Revenue was $383.3 billion.", refusal: null });
    const events = await collect(runAgent("q", { complete, toolbox }));
    const answer = events.find((e) => e.type === "answer");
    expect(answer).toMatchObject({ type: "answer", unverified: [] });
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", trace: { llmCalls: 2, toolCalls: 1, toolErrors: 0, tokens: 20 } });
  });

  it("flags a hallucinated figure", async () => {
    let n = 0;
    const complete: CompleteFn = () =>
      n++ === 0 ? reply(toolCall) : reply({ role: "assistant", content: "Revenue was $999 billion.", refusal: null });
    const events = await collect(runAgent("q", { complete, toolbox }));
    expect(events.find((e) => e.type === "answer")).toMatchObject({ unverified: ["$999 billion"] });
  });

  it("stops at the step limit", async () => {
    const complete: CompleteFn = () => reply(toolCall);
    const events = await collect(runAgent("q", { complete, toolbox, maxSteps: 2 }));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("surfaces provider failure as an error event", async () => {
    const complete: CompleteFn = () => Promise.reject(new Error("All providers failed."));
    const events = await collect(runAgent("q", { complete, toolbox }));
    expect(events[0]).toMatchObject({ type: "error" });
  });
});
