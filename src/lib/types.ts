export type TraceStep = {
  type: "llm" | "tool";
  name: string;
  ms: number;
  ok: boolean;
  provider?: string;
  model?: string;
  tokens?: number;
  detail?: string;
};

export type Trace = {
  runId: string;
  question: string;
  steps: TraceStep[];
  totalMs: number;
  llmCalls: number;
  toolCalls: number;
  toolErrors: number;
  tokens: number;
};

export type AgentEvent =
  | { type: "step"; step: TraceStep }
  | { type: "answer"; text: string; unverified: string[] }
  | { type: "error"; message: string }
  | { type: "done"; trace: Trace };
