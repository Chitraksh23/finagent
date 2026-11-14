import OpenAI from "openai";
import { cached } from "./cache";
import type { ToolDef } from "./mcp-client";

export type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type AssistantMsg = OpenAI.Chat.Completions.ChatCompletionMessage;

export type Provider = { name: string; baseURL: string; key?: string; model: string };
export type LlmResult = { message: AssistantMsg; provider: string; model: string; tokens: number; ms: number };
export type CompleteFn = (messages: ChatMsg[], tools: ToolDef[]) => Promise<LlmResult>;

/** All free-tier, OpenAI-compatible. Order = fallback order. Only providers with a key are used. */
export function providers(env: Record<string, string | undefined> = process.env): Provider[] {
  const all: Provider[] = [
    { name: "groq", baseURL: "https://api.groq.com/openai/v1", key: env.GROQ_API_KEY, model: env.GROQ_MODEL ?? "llama-3.3-70b-versatile" },
    { name: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? "gemini-2.5-flash" },
    { name: "openrouter", baseURL: "https://openrouter.ai/api/v1", key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free" },
  ];
  return all.filter((p) => p.key);
}

export const complete: CompleteFn = (messages, tools) =>
  cached("llm", { messages, tools: tools.map((t) => t.name) }, async () => {
    const list = providers();
    if (list.length === 0) throw new Error("No LLM key configured. Set GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY.");

    const errors: string[] = [];
    for (const p of list) {
      const t0 = Date.now();
      try {
        const client = new OpenAI({ apiKey: p.key, baseURL: p.baseURL, timeout: 20_000, maxRetries: 0 });
        const res = await client.chat.completions.create({
          model: p.model,
          messages,
          temperature: 0,
          tools: tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
        });
        return { message: res.choices[0].message, provider: p.name, model: p.model, tokens: res.usage?.total_tokens ?? 0, ms: Date.now() - t0 };
      } catch (e) {
        errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(`All providers failed. ${errors.join(" | ")}`);
  });
