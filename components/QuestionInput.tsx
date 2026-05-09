"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRunStore } from "@/lib/store";
import { ArrowRight, Loader2 } from "lucide-react";

const SUGGESTIONS = [
  "What does the latest research say about GLP-1s and cognition?",
  "Compare current battery chemistries for grid storage in 2026.",
  "Is the housing market cooling or just pausing? US, Q2 2026.",
];

export function QuestionInput() {
  const router = useRouter();
  const startRun = useRunStore((s) => s.startRun);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  function submit() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    const runId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    startRun(runId, q);
    router.push(`/research/${runId}`);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <Label htmlFor="question" className="text-base">
        Your research question
      </Label>
      <p className="mt-1 text-xs text-muted-foreground">
        Be specific. Time-bounded, scoped questions produce better reports.
      </p>
      <textarea
        id="question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="What is…"
        rows={4}
        className="mt-3 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Try:</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setQuestion(s)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {s.length > 40 ? s.slice(0, 40) + "…" : s}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          ⌘+Enter to start
        </p>
        <Button onClick={submit} disabled={!question.trim() || busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Starting…
            </>
          ) : (
            <>
              Start research <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
