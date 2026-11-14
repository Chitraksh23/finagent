export type CalcOp = "pct_change" | "cagr" | "margin" | "ratio";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function calculate(op: CalcOp, a: number, b: number, years?: number): { result: number; formula: string } {
  const r = rawCalc(op, a, b, years);
  return { ...r, result: round(r.result) };
}

function rawCalc(op: CalcOp, a: number, b: number, years?: number): { result: number; formula: string } {
  switch (op) {
    case "pct_change":
      if (a === 0) throw new Error("pct_change: starting value a is zero");
      return { result: ((b - a) / Math.abs(a)) * 100, formula: "(b - a) / |a| * 100" };
    case "cagr":
      if (!years || years <= 0) throw new Error("cagr: years must be > 0");
      if (a <= 0 || b <= 0) throw new Error("cagr: a and b must be positive");
      return { result: (Math.pow(b / a, 1 / years) - 1) * 100, formula: "((b / a) ^ (1 / years) - 1) * 100" };
    case "margin":
      if (b === 0) throw new Error("margin: denominator b is zero");
      return { result: (a / b) * 100, formula: "a / b * 100" };
    case "ratio":
      if (b === 0) throw new Error("ratio: denominator b is zero");
      return { result: a / b, formula: "a / b" };
  }
}
