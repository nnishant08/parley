"use client";

import { CircleDollarSign } from "lucide-react";
import {
  TYPICAL_TOTAL,
  WORST_CASE_TOTAL,
  DEFAULT_COST_CAP,
  fmtUSD,
  actualCostEstimate,
} from "@/lib/cost";
import type { ResearchRun } from "@/lib/store";

/**
 * Pre-run estimate (no run yet). Shown next to the "Start research"
 * button so the user knows roughly what they're spending.
 */
export function PreRunCostEstimate() {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <CircleDollarSign className="h-3.5 w-3.5" />
      Estimated cost: <strong className="text-foreground">{fmtUSD(TYPICAL_TOTAL)}</strong> typical,{" "}
      up to {fmtUSD(WORST_CASE_TOTAL)} worst case (cap {fmtUSD(DEFAULT_COST_CAP)})
    </div>
  );
}

/**
 * Post-run actual cost (sums stages that actually fired). Shown
 * inside the run page once any stage has spent money.
 */
export function ActualCost({ run }: { run: ResearchRun }) {
  const { total, breakdown } = actualCostEstimate(run);
  if (total === 0) return null;

  return (
    <details className="mt-2 inline-block">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        <CircleDollarSign className="mr-1 inline h-3.5 w-3.5" />
        Run cost so far:{" "}
        <strong className="text-foreground">{fmtUSD(total)}</strong>
      </summary>
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {breakdown.map((b, i) => (
          <li key={i} className="flex justify-between gap-6">
            <span>{b.label}</span>
            <span className="font-mono">{fmtUSD(b.amount)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
