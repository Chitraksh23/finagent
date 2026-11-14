import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Record/replay layer. RECORD=1 stores results in ./fixtures, REPLAY=1 serves them
 * with zero network or LLM calls (used in CI so evals cost nothing and never hit rate limits).
 */
export function cacheMode(): "record" | "replay" | "off" {
  if (process.env.REPLAY === "1") return "replay";
  if (process.env.RECORD === "1") return "record";
  return "off";
}

export async function cached<T>(namespace: string, key: unknown, fn: () => Promise<T>): Promise<T> {
  const mode = cacheMode();
  if (mode === "off") return fn();

  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24);
  const file = path.join(process.env.FIXTURE_DIR ?? "fixtures", namespace, `${hash}.json`);

  if (mode === "replay") {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      throw new Error(`Replay miss for ${namespace}/${hash}. Run "npm run eval:record" and commit fixtures/.`);
    }
  }

  const value = await fn();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
}
