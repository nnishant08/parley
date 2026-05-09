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

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Redirect home if we lost the run state (e.g. user pasted a URL).
  // Only watch hydrated + run.id (not the whole run object) so this
  // effect doesn't re-fire on every state update.
  const runIdActual = run?.id;
  useEffect(() => {
    if (!hydrated) return;
    if (!runIdActual || runIdActual !== runId) {
      const t = setTimeout(() => router.replace("/"), 50);
      return () => clearTimeout(t);
    }
  }, [hydrated, runIdActual, runId, router]);

  // Kick off Claude exactly once per (runId, apiKey) pair.
  //
  // Two subtle traps live here, both fixed by the current shape:
  //
  //  1. Don't subscribe to `run` in the deps. The effect itself calls
  //     markLaunched/initProvider/setStatus which mutate `run`, so the
  //     effect would re-fire mid-fetch and the cleanup would abort the
  //     in-flight request. We read the fresh run via getState() instead.
  //
  //  2. Don't abort the fetch from the effect's cleanup. React strict
  //     mode (dev only) runs setup → cleanup → setup on every mount; if
  //     the cleanup aborts the fetch and markLaunched then blocks the
  //     re-launch, every dev request dies in the first millisecond.
  //     The fetch runs to completion regardless of unmount; the onEvent
  //     dispatcher drops events if the user has navigated to a different
  //     runId in the meantime. Proper cancellation will land in step 15.
  const apiKey = keys?.anthropic;
  useEffect(() => {
    if (!runId || !apiKey) return;
    const cur = useRunStore.getState().current;
    if (!cur || cur.id !== runId) return;

    const {
      markLaunched,
      initProvider,
      setStatus,
      appendMarkdown,
      appendSources,
      appendSearchQuery,
      setError,
    } = useRunStore.getState();

    if (!markLaunched("anthropic")) return;

    initProvider("anthropic");
    setStatus("anthropic", "planning");

    const startedForRunId = runId;
    const isStillCurrent = () =>
      useRunStore.getState().current?.id === startedForRunId;

    void researchClaude({
      question: cur.question,
      apiKey,
      contextDocs: cur.contextDocs,
      // intentionally no AbortSignal — see comment block above
      onEvent: (e) => {
        if (!isStillCurrent()) return;
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
  }, [runId, apiKey]);

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
