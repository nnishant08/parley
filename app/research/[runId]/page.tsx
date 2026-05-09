"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ModelCard } from "@/components/ModelCard";
import { researchClaude, type RunEvent } from "@/lib/providers/anthropic";
import { researchMistral } from "@/lib/providers/mistral";
import { researchOpenAI } from "@/lib/providers/openai";
import { researchGemini } from "@/lib/providers/gemini";
import {
  useKeyStore,
  useRunStore,
  type ProviderRun,
} from "@/lib/store";
import { PROVIDERS, PROVIDER_LABEL, type Provider } from "@/lib/types";

const EMPTY_RUN: ProviderRun = {
  status: "idle",
  markdown: "",
  sources: [],
  searchQueries: [],
};

type Runner = (args: {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  onEvent: (e: RunEvent) => void;
}) => Promise<void>;

// Which providers have a real runner wired up. Steps 5 (openai) and 6
// (gemini) will fill in the remaining slots; until then those cards
// render as placeholders below.
const RUNNERS: Partial<Record<Provider, Runner>> = {
  anthropic: researchClaude,
  mistral: researchMistral,
  openai: researchOpenAI,
  gemini: researchGemini,
};

const APPROXIMATED: Partial<Record<Provider, boolean>> = {
  // Mistral has no Deep Research API; spec calls this out as
  // "approximated" and asked us to label the card.
  mistral: true,
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
  // Subscribe only to run.id, not the whole run object, so this effect
  // doesn't re-fire on every state update.
  const runIdActual = run?.id;
  useEffect(() => {
    if (!hydrated) return;
    if (!runIdActual || runIdActual !== runId) {
      const t = setTimeout(() => router.replace("/"), 50);
      return () => clearTimeout(t);
    }
  }, [hydrated, runIdActual, runId, router]);

  // Kick off all wired-up providers exactly once per (runId, keys) pair.
  //
  // Two subtle traps that bit me on step 3, both still relevant here:
  //
  //  1. Don't put `run` in the deps. The effect mutates run via
  //     markLaunched/initProvider/setStatus, which would re-fire the
  //     effect. We read the fresh run via getState() inside instead.
  //
  //  2. Don't abort the fetch from cleanup. React strict mode runs
  //     setup → cleanup → setup in dev; the cleanup would abort the
  //     in-flight fetch and markLaunched would block the re-launch.
  //     Fetches run to completion; onEvent drops events if the user
  //     has navigated to a different runId. Step 15 will replace this
  //     with a ref-tracked controller that survives strict mode.
  useEffect(() => {
    if (!runId || !keys) return;
    const cur = useRunStore.getState().current;
    if (!cur || cur.id !== runId) return;

    const store = useRunStore.getState();
    const startedForRunId = runId;
    const isStillCurrent = () =>
      useRunStore.getState().current?.id === startedForRunId;

    for (const provider of PROVIDERS) {
      const runner = RUNNERS[provider];
      const apiKey = keys[provider];
      if (!runner || !apiKey) continue;
      if (!store.markLaunched(provider)) continue;

      store.initProvider(provider);
      store.setStatus(provider, "planning");

      void runner({
        question: cur.question,
        apiKey,
        contextDocs: cur.contextDocs,
        onEvent: (e) => {
          if (!isStillCurrent()) return;
          const s = useRunStore.getState();
          switch (e.type) {
            case "status":
              if (e.status) s.setStatus(provider, e.status, e.detail);
              break;
            case "text_delta":
              if (e.textDelta) s.appendMarkdown(provider, e.textDelta);
              break;
            case "search_query":
              if (e.query) s.appendSearchQuery(provider, e.query);
              break;
            case "search_results":
              if (e.sources?.length) s.appendSources(provider, e.sources);
              break;
            case "error":
              if (e.error) s.setError(provider, e.error);
              break;
          }
        },
      });
    }
  }, [runId, keys]);

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
        {PROVIDERS.map((p) => {
          const wired = !!RUNNERS[p];
          if (!wired) {
            return (
              <section
                key={p}
                className="rounded-lg border border-dashed border-border bg-card/40 p-5 text-xs text-muted-foreground"
              >
                <div className="font-semibold uppercase tracking-wider">
                  {PROVIDER_LABEL[p]}
                </div>
                <p className="mt-2">Coming online soon.</p>
              </section>
            );
          }
          return (
            <ModelCard
              key={p}
              provider={p}
              run={run.providers[p] ?? EMPTY_RUN}
              approximated={APPROXIMATED[p]}
            />
          );
        })}
      </div>
    </main>
  );
}
