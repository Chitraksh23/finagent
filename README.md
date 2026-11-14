# FinAgent

A tool-using research agent for US public companies. It answers questions from **SEC EDGAR** data through two
**MCP servers**, does arithmetic with a deterministic calculator tool, **verifies every figure in its answer against
tool output**, and shows a live run trace (steps, latency, tokens). Deploys to Vercel on free tiers only.

```
Browser ── POST /api/chat (NDJSON stream) ──► agent loop (src/lib/agent.ts)
                                                 │  plan → tool calls → answer → verify figures
                          LLM fallback chain ◄───┤  Groq → Gemini → OpenRouter (all free, OpenAI-compatible)
                                                 ▼
                                   in-process MCP client (InMemoryTransport)
                                    ├─ filings server: search_company, get_fundamentals, list_filings (SEC EDGAR)
                                    └─ market server:  get_quote, calculate
Same two servers are also exposed over HTTP:  /mcp/filings   /mcp/market   (stateless Streamable HTTP)
```

## Run locally
```bash
npm install
cp .env.example .env.local      # add at least one free LLM key + SEC_USER_AGENT
npm run dev                     # http://localhost:3000
npm test                        # unit tests, no network
```

## Deploy to Vercel (free Hobby plan)
1. Push this folder to a GitHub repo.
2. vercel.com → Add New → Project → import the repo (framework auto-detects as Next.js).
3. Add environment variables from `.env.example` (`GROQ_API_KEY`, optionally `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `SEC_USER_AGENT`).
4. Deploy. Your MCP endpoints will be `https://<project>.vercel.app/mcp/filings` and `/mcp/market`.

Free keys: Groq (console.groq.com), Gemini (aistudio.google.com), OpenRouter (openrouter.ai). Providers are tried in that order and only if a key is set.

## Evals (zero cost in CI)
`evals/dataset.json` has 9 cases: metric lookups, margins (calculator required), filing links, an unknown company, and an advice request.
Ground truth is fetched live from EDGAR, so answers are checked against real data, not hard-coded numbers.
Each case is graded on: required tools used, figures grounded in tool output, correctness, latency, tool errors.

```bash
npm run eval:record   # once, locally with real keys: stores LLM + SEC responses in fixtures/
git add fixtures && git commit -m "eval fixtures"
npm run eval:replay   # what CI runs: no network, no keys, fails the build if pass rate < 80%
```
Re-record when you change the prompt, tools or models. Use `ONLY=aapl-revenue npm run eval:record` to re-record one case.

## Use the MCP servers from other clients
Point any MCP client that supports remote (Streamable HTTP) servers at `https://<project>.vercel.app/mcp/filings`.

## Limits (be honest in interviews)
- Free LLM tiers are rate-limited and models get retired; pin model IDs via env vars. A best-effort per-IP limiter protects your quota, but in-memory limits are per serverless instance.
- Number verification checks that each figure appears in tool output within its own rounding. It does not prove the *interpretation* is right.
- Fundamentals cover US filers with XBRL 10-K data. Quotes use an unofficial Yahoo endpoint and may break.
- No persistence: traces go to Vercel function logs as JSON (`evt: "agent_run"`). Next step is shipping them to a trace store.
- Agent loop is hand-written (no framework) so each step is inspectable. Retrieval over filing text (RAG) is a natural next tool.
