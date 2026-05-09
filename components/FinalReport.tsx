"use client";

import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ScrollText,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import type { ProviderRun, SynthesisState } from "@/lib/store";
import { PROVIDER_LABEL, PROVIDERS, type Provider } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACCENT_DOT: Record<Provider, string> = {
  anthropic: "bg-anthropic",
  openai: "bg-openai",
  gemini: "bg-gemini",
  mistral: "bg-mistral",
};

export function FinalReport({
  state,
  providers,
  onRetry,
}: {
  state: SynthesisState;
  providers: Partial<Record<Provider, ProviderRun>>;
  onRetry?: () => void;
}) {
  const { status, markdown, error, synthesizer } = state;
  // Show retry when synthesis stalled (idle for too long after stage 2 fired
  // is hard to detect from props alone; we show retry whenever the user
  // could plausibly need it: failed, or stuck-idle/writing with no markdown).
  const canRetry =
    !!onRetry &&
    (status === "failed" || (status !== "done" && markdown.length === 0));

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
        <div className="flex items-center gap-2">
          {canRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry synthesis
            </Button>
          )}
          <StatusPill status={status} />
        </div>
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

      <RawAnswers providers={providers} />
      <CombinedSources providers={providers} />
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

function RawAnswers({
  providers,
}: {
  providers: Partial<Record<Provider, ProviderRun>>;
}) {
  const withReports = PROVIDERS.filter(
    (p) => providers[p]?.markdown && providers[p]!.markdown.length > 0,
  );
  if (withReports.length === 0) return null;

  return (
    <div className="border-t border-border px-6 py-5">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          Per-model raw answers ({withReports.length})
        </summary>
        <div className="mt-4 space-y-4">
          {withReports.map((p) => {
            const run = providers[p]!;
            return (
              <details
                key={p}
                className="rounded-md border border-border bg-background/40"
              >
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/40">
                  <span className={cn("h-2 w-2 rounded-full", ACCENT_DOT[p])} />
                  {PROVIDER_LABEL[p]}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {run.markdown.length.toLocaleString()} chars ·{" "}
                    {run.sources.length} source
                    {run.sources.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="border-t border-border px-4 py-3">
                  <Markdown>{run.markdown}</Markdown>
                </div>
              </details>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function CombinedSources({
  providers,
}: {
  providers: Partial<Record<Provider, ProviderRun>>;
}) {
  const map = new Map<
    string,
    { url: string; title?: string; citedBy: Set<Provider> }
  >();
  for (const p of PROVIDERS) {
    const run = providers[p];
    if (!run) continue;
    for (const s of run.sources) {
      const existing = map.get(s.url);
      if (existing) {
        existing.citedBy.add(p);
        if (!existing.title && s.title) existing.title = s.title;
      } else {
        map.set(s.url, {
          url: s.url,
          title: s.title,
          citedBy: new Set([p]),
        });
      }
    }
  }
  if (map.size === 0) return null;

  // Sort: most-cited first (consensus signal), then alphabetical
  const sorted = Array.from(map.values()).sort((a, b) => {
    if (b.citedBy.size !== a.citedBy.size) return b.citedBy.size - a.citedBy.size;
    return (a.title ?? a.url).localeCompare(b.title ?? b.url);
  });

  return (
    <div className="border-t border-border px-6 py-5">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          Combined sources ({sorted.length}) — deduplicated across all four
          models
        </summary>
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {sorted.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 px-3 py-2 text-xs"
            >
              <div className="flex shrink-0 gap-1 pt-0.5">
                {PROVIDERS.map((p) => (
                  <span
                    key={p}
                    title={`${PROVIDER_LABEL[p]}${s.citedBy.has(p) ? " cited this" : " did not cite this"}`}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      s.citedBy.has(p)
                        ? ACCENT_DOT[p]
                        : "bg-muted opacity-30",
                    )}
                  />
                ))}
              </div>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 items-start gap-1 text-sky-400 hover:underline"
              >
                <span className="truncate">{s.title || s.url}</span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
              </a>
              <span className="shrink-0 text-muted-foreground">
                {s.citedBy.size}/4
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
