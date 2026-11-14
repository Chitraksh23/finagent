"use client";

import { useRef, useState } from "react";
import type { AgentEvent, Trace, TraceStep } from "../lib/types";

const EXAMPLES = [
  "How much did Apple's revenue grow in its latest fiscal year?",
  "What is Microsoft's net margin for the last 3 years?",
  "Show Nvidia's most recent 10-K filing and its operating cash flow.",
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [answer, setAnswer] = useState<{ text: string; unverified: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setSteps([]);
    setAnswer(null);
    setError(null);
    setTrace(null);
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as AgentEvent;
          if (ev.type === "step") setSteps((s) => [...s, ev.step]);
          else if (ev.type === "answer") setAnswer({ text: ev.text, unverified: ev.unverified });
          else if (ev.type === "error") setError(ev.message);
          else if (ev.type === "done") setTrace(ev.trace);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slowest = Math.max(1, ...steps.map((s) => s.ms));

  return (
    <main>
      <h1>FinAgent</h1>
      <p className="lede">
        Ask about a US public company. The agent pulls figures from SEC filings through tools, does the math with a
        calculator, and flags any number in its answer that no tool returned.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What was Tesla's operating cash flow last year?"
          aria-label="Question"
          maxLength={500}
        />
        <button type="submit" disabled={busy || !question.trim()}>{busy ? "Researching" : "Ask"}</button>
      </form>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" disabled={busy} onClick={() => { setQuestion(ex); void ask(ex); }}>{ex}</button>
        ))}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {answer && (
        <section aria-live="polite">
          <p className="answer">{answer.text}</p>
          {answer.unverified.length === 0 ? (
            <span className="badge ok">Every figure traced to a tool result</span>
          ) : (
            <span className="badge warn">Not found in tool results: {answer.unverified.join(", ")}</span>
          )}
        </section>
      )}

      {steps.length > 0 && (
        <section>
          <h2>Run trace</h2>
          <ol className="ledger">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="name">
                  {s.type === "llm" ? `Model call` : s.name}
                  <span className="meta">{s.type === "llm" ? `${s.provider}, ${s.tokens ?? 0} tokens` : s.detail}</span>
                </span>
                <span className="track"><div className={`bar${s.ok ? "" : " fail"}`} style={{ width: `${Math.max(2, (s.ms / slowest) * 100)}%` }} /></span>
                <span className="ms">{s.ms} ms</span>
              </li>
            ))}
          </ol>
          {trace && (
            <p className="totals">
              {trace.totalMs} ms total, {trace.llmCalls} model calls, {trace.toolCalls} tool calls
              {trace.toolErrors > 0 ? `, ${trace.toolErrors} failed` : ""}, {trace.tokens} tokens
            </p>
          )}
        </section>
      )}
    </main>
  );
}
