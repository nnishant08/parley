"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ModelCard } from "@/components/ModelCard";
import { researchClaude } from "@/lib/providers/anthropic";
import { useKeyStore, useRunStore, type ProviderRun } from "@/lib/store";
import type { Provider } from "@/lib/types";

const EMPTY_RUN: ProviderRun = {
  status: "idle",
  markdown: "",
  sources: [],
  searchQueries: [],
};

export default function RunPage() {
  const params = useParams<{ runId: string }>();
  const router = useRouter();
  const runId = params.runId;

  const keys = useKeyStore((s) => s.keys);
  const hydrated = useKeyStore((s) => s.hydrated);
  const hydrate = useKeyStore((s) => s.hydrate);
  const run = useRunStore((s) => s.current);
  const initProvider = useRunStore((s) => s.initProvider);
  const markLaunched = useRunStore((s) => s.markLaunched);
  const setStatus = useRunStore((s) => s.setStatus);
  const appendMarkdown = useRunStore((s) => s.appendMarkdown);
  const appendSources = useRunStore((s) => s.appendSources);
  const appendSearchQuery = useRunStore((s) => s.appendSearchQuery);
  const setError = useRunStore((s) => s.setError);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Redirect home if we lost the run state (e.g. user pasted a URL).
  useEffect(() => {
    if (!hydrated) return;
    if (!run || run.id !== runId) {
      const t = setTimeout(() => router.replace("/"), 50);
      return () => clearTimeout(t);
    }
  }, [hydrated, run, runId, router]);

  // Kick off Claude. Guarded by markLaunched so React strict mode's
  // double-invocation of effects doesn't double-fire the API call.
  useEffect(() => {
    if (!run || run.id !== runId) return;
    if (!keys?.anthropic) return;
    if (!markLaunched("anthropic")) return;

    initProvider("anthropic");
    setStatus("anthropic", "planning");

    const ac = new AbortController();
    void researchClaude({
      question: run.question,
      apiKey: keys.anthropic,
      contextDocs: run.contextDocs,
      signal: ac.signal,
      onEvent: (e) => {
        switch (e.type) {
          case "status":
            if (e.status) setStatus("anthropic", e.status, e.detail);
            break;
          case "text_delta":
            if (e.textDelta) appendMarkdown("anthropic", e.textDelta);
            break;
          case "search_query":
            if (e.query) appendSearchQuery("anthropic", e.query);
            break;
          case "search_results":
            if (e.sources?.length) appendSources("anthropic", e.sources);
            break;
          case "error":
            if (e.error) setError("anthropic", e.error);
            break;
        }
      },
    });

    return () => ac.abort();
  }, [
    run,
    runId,
    keys?.anthropic,
    initProvider,
    markLaunched,
    setStatus,
    appendMarkdown,
    appendSources,
    appendSearchQuery,
    setError,
  ]);

  if (!hydrated) {
    return (
      <main className="container mx-auto max-w-5xl px-6 py-16 text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  if (!run || run.id !== runId) {
    return (
      <main className="container mx-auto max-w-5xl px-6 py-16 text-sm text-muted-foreground">
        Run not found. Redirecting…
      </main>
    );
  }

  const claudeRun = run.providers.anthropic ?? EMPTY_RUN;

  // Step 3 only shows the Claude card. Steps 4–6 will fill in the others.
  const placeholders: Provider[] = ["mistral", "openai", "gemini"];

  return (
    <main className="container mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> New question
        </Link>
        <span className="text-xs text-muted-foreground">
          Run {runId.slice(0, 8)}
        </span>
      </div>

      <header className="mb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Question
        </h2>
        <p className="mt-1 text-lg leading-snug">{run.question}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <ModelCard provider="anthropic" run={claudeRun} />
        {placeholders.map((p) => (
          <section
            key={p}
            className="rounded-lg border border-dashed border-border bg-card/40 p-5 text-xs text-muted-foreground"
          >
            <div className="font-semibold uppercase tracking-wider">
              {p}
            </div>
            <p className="mt-2">Coming online in steps 4–6.</p>
          </section>
        ))}
      </div>
    </main>
  );
}
