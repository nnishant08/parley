import type { ResearchRun } from "@/lib/store";
import { PROVIDERS, type Provider } from "@/lib/types";

/**
 * Per-spec section 10 cost estimates. These are rough — actual
 * costs depend on prompt length, search tool usage, and the size of
 * each model's output. We use them both for the pre-run estimate
 * and for the post-run "actual" total (which sums in only the
 * stages that actually completed).
 *
 *  - Stage 1 (deep research × 4):
 *      o3-deep-research:  ~$4
 *      o4-mini-deep:      ~$1.50
 *      gemini deep prev:  ~$2
 *      gemini deep max:   ~$5
 *      claude + websearch:~$0.50
 *      mistral + websearch:~$0.30
 *  - Stage 2 critique (per provider): ~$0.20
 *  - Stage 3 synthesis:               ~$0.50
 *  - Follow-up (per ask):             ~$0.30
 */
export const STAGE1_COST: Record<Provider, number> = {
  anthropic: 0.5,
  mistral: 0.3,
  // o4-mini-deep-research is now the default (~$1.5/run). o3 is
  // still available via tier="o3" and runs ~$4/run.
  openai: 1.5,
  gemini: 2.0, // preview default; max is ~5
};
export const CRITIQUE_COST_PER_PROVIDER = 0.2;
export const SYNTHESIS_COST = 0.5;
export const FOLLOWUP_COST = 0.3;

export const TYPICAL_TOTAL =
  PROVIDERS.reduce((s, p) => s + STAGE1_COST[p], 0) +
  4 * CRITIQUE_COST_PER_PROVIDER +
  SYNTHESIS_COST;

export const WORST_CASE_TOTAL = TYPICAL_TOTAL * 2; // rough multiplier

export const DEFAULT_COST_CAP = 20;

/**
 * Sum the estimated cost of stages that actually completed.
 * (We could be more precise with token-level usage from each
 * provider's done event — that's the step-15 polish.)
 */
export function actualCostEstimate(run: ResearchRun): {
  total: number;
  breakdown: Array<{ label: string; amount: number }>;
} {
  const breakdown: Array<{ label: string; amount: number }> = [];
  let total = 0;

  for (const p of PROVIDERS) {
    const r = run.providers[p];
    if (!r) continue;
    if (
      r.status === "done" ||
      r.status === "critiquing" ||
      r.status === "critique_done"
    ) {
      breakdown.push({ label: `${p} stage 1`, amount: STAGE1_COST[p] });
      total += STAGE1_COST[p];
    }
  }

  for (const p of PROVIDERS) {
    if (run.critiqueLaunched[p]) {
      breakdown.push({
        label: `${p} critique`,
        amount: CRITIQUE_COST_PER_PROVIDER,
      });
      total += CRITIQUE_COST_PER_PROVIDER;
    }
  }

  if (
    run.synthesis.status === "writing" ||
    run.synthesis.status === "done"
  ) {
    breakdown.push({ label: "synthesis", amount: SYNTHESIS_COST });
    total += SYNTHESIS_COST;
  }

  return { total, breakdown };
}

export function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}
