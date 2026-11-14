export type Figure = { raw: string; value: number; decimals: number; scale: number; isFigure: boolean };

const SCALES: Record<string, number> = {
  trillion: 1e12, tn: 1e12, t: 1e12,
  billion: 1e9, bn: 1e9, b: 1e9,
  million: 1e6, mn: 1e6, m: 1e6,
  thousand: 1e3, k: 1e3,
};
const FIGURE_RE = /(\$)?\s?(-?\d[\d,]*(?:\.\d+)?)\s?(%|trillion|billion|million|thousand|tn|bn|mn|[tbmk])?(?![a-z])/gi;

/** Pull numeric claims out of text. Only money, percentages, scaled and decimal numbers count as "figures". */
export function parseFigures(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    const [raw, dollar, num, suffix] = m;
    const clean = num.replace(/,/g, "");
    const decimals = clean.includes(".") ? clean.split(".")[1].length : 0;
    const scale = suffix && suffix !== "%" ? (SCALES[suffix.toLowerCase()] ?? 1) : 1;
    const isYear = !dollar && !suffix && /^(19|20)\d{2}$/.test(clean);
    const isFigure = !isYear && (Boolean(dollar) || suffix !== undefined || num.includes(",") || decimals > 0);
    out.push({ raw: raw.trim(), value: parseFloat(clean) * scale, decimals, scale, isFigure });
  }
  return out;
}

export function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map((m) => parseFloat(m[0].replace(/,/g, "")));
}

/** Does a rounded figure (e.g. "$383.3 billion") agree with a source number within its own rounding? */
export function matches(fig: Figure, source: number): boolean {
  const half = 0.5 * Math.pow(10, -fig.decimals) * fig.scale;
  const tol = Math.max(half, Math.abs(source) * 1e-4);
  return Math.abs(Math.abs(fig.value) - Math.abs(source)) <= tol;
}

/** Figures stated in the answer that appear in none of the tool outputs. */
export function findUnverified(answer: string, toolOutputs: string[]): string[] {
  const sources = toolOutputs.flatMap(numbersIn);
  return parseFigures(answer)
    .filter((f) => f.isFigure && !sources.some((s) => matches(f, s)))
    .map((f) => f.raw);
}

/** Does the answer state this value (to within its own rounding)? Used by evals. */
export function containsValue(answer: string, value: number): boolean {
  return parseFigures(answer).some((f) => f.isFigure && matches(f, value));
}
