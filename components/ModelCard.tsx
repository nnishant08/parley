"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Search, FileText, Sparkles } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { Provider } from "@/lib/types";
import { PROVIDER_LABEL } from "@/lib/types";
import type { ProviderRun, ProviderRunStatus } from "@/lib/store";
import { cn } from "@/lib/utils";

const ACCENT: Record<Provider, string> = {
  anthropic: "border-l-anthropic",
  openai: "border-l-openai",
  gemini: "border-l-gemini",
  mistral: "border-l-mistral",
};

const ACCENT_DOT: Record<Provider, string> = {
  anthropic: "bg-anthropic",
  openai: "bg-openai",
  gemini: "bg-gemini",
  mistral: "bg-mistral",
};

const STATUS_LABEL: Record<ProviderRunStatus, string> = {
  idle: "Waiting",
  planning: "Planning",
  searching: "Searching",
  writing: "Writing",
  done: "Done",
  failed: "Failed",
};

function StatusIcon({ status }: { status: ProviderRunStatus }) {
  const cls = "h-4 w-4";
  switch (status) {
    case "idle":
      return <Sparkles className={cn(cls, "text-muted-foreground")} />;
    case "planning":
      return <Loader2 className={cn(cls, "animate-spin text-muted-foreground")} />;
    case "searching":
      return <Search className={cn(cls, "animate-pulse text-sky-400")} />;
    case "writing":
      return <FileText className={cn(cls, "animate-pulse text-amber-400")} />;
    case "done":
      return <CheckCircle2 className={cn(cls, "text-emerald-500")} />;
    case "failed":
      return <AlertTriangle className={cn(cls, "text-destructive")} />;
  }
}

function useElapsed(startedAt?: number, endedAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [startedAt, endedAt]);
  if (!startedAt) return null;
  const ms = (endedAt ?? now) - startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ModelCard({
  provider,
  run,
  approximated,
}: {
  provider: Provider;
  run: ProviderRun;
  approximated?: boolean;
}) {
  const elapsed = useElapsed(run.startedAt, run.endedAt);

  return (
    <section
      className={cn(
        "rounded-lg border border-border border-l-4 bg-card p-5",
        ACCENT[provider],
      )}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", ACCENT_DOT[provider])} />
          <h3 className="font-semibold">{PROVIDER_LABEL[provider]}</h3>
          {approximated && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              approximated
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {elapsed && <span>{elapsed}</span>}
          <StatusIcon status={run.status} />
          <span className="font-medium">{STATUS_LABEL[run.status]}</span>
        </div>
      </header>

      {run.detail && run.status !== "done" && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {run.status === "searching" ? `Searching: ${run.detail}` : run.detail}
        </p>
      )}

      {run.status === "failed" && run.error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {run.error}
        </p>
      )}

      {run.markdown && (
        <div className="mt-4 max-h-[600px] overflow-y-auto rounded-md border border-border bg-background/50 px-4 py-3">
          <Markdown>{run.markdown}</Markdown>
        </div>
      )}

      {!run.markdown && run.status !== "idle" && run.status !== "failed" && (
        <div className="mt-4 space-y-2">
          {run.searchQueries.length > 0 && (
            <ul className="space-y-1">
              {run.searchQueries.slice(-5).map((q, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <Search className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="truncate">{q}</span>
                </li>
              ))}
            </ul>
          )}
          {run.status === "writing" && !run.markdown && (
            <div className="h-2 animate-shimmer rounded-md bg-[linear-gradient(90deg,transparent,hsl(var(--secondary)),transparent)] bg-[length:200%_100%]" />
          )}
        </div>
      )}

      {run.sources.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {run.sources.length} source{run.sources.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1">
            {run.sources.map((s, i) => (
              <li key={i} className="text-xs">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:underline"
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
