"use client";

import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ScrollText,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { SynthesisState } from "@/lib/store";
import { PROVIDER_LABEL, type Provider } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FinalReport({ state }: { state: SynthesisState }) {
  const { status, markdown, error, synthesizer } = state;

  return (
    <section className="mt-10 rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Synthesized report</h2>
          {synthesizer && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {PROVIDER_LABEL[synthesizer as Provider]}
            </span>
          )}
        </div>
        <StatusPill status={status} />
      </header>

      <div className="px-6 py-5">
        {status === "idle" && (
          <p className="text-sm text-muted-foreground">
            Waiting for all four research runs and their critiques before
            synthesis kicks off.
          </p>
        )}

        {status === "failed" && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error || "Synthesis failed."}
          </p>
        )}

        {(status === "writing" || status === "done") && (
          <>
            {markdown ? (
              <Markdown>{markdown}</Markdown>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Synthesizer is reading all four reports + critiques…
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: SynthesisState["status"] }) {
  const cls = "h-3.5 w-3.5";
  if (status === "idle")
    return (
      <span className="text-xs text-muted-foreground">Pending stage 1 + 2</span>
    );
  if (status === "writing")
    return (
      <span className="flex items-center gap-1 text-xs text-amber-300">
        <Loader2 className={cn(cls, "animate-spin")} /> Writing
      </span>
    );
  if (status === "done")
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 className={cls} /> Done
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <AlertTriangle className={cls} /> Failed
    </span>
  );
}
