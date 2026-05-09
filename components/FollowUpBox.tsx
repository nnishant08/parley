"use client";

import { useState } from "react";
import { MessageCircleQuestion, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import { runFollowup } from "@/lib/providers/followup";
import { useKeyStore } from "@/lib/store";
import type { Provider } from "@/lib/types";

interface Turn {
  question: string;
  answer: string;
  status: "writing" | "done" | "failed";
  error?: string;
}

export function FollowUpBox({
  originalQuestion,
  finalReport,
  synthesizer,
}: {
  originalQuestion: string;
  finalReport: string;
  synthesizer: Provider;
}) {
  const apiKey = useKeyStore((s) => s.keys?.[synthesizer]);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = draft.trim();
    if (!q || busy || !apiKey) return;
    setBusy(true);
    setDraft("");
    const idx = turns.length;
    setTurns((prev) => [
      ...prev,
      { question: q, answer: "", status: "writing" },
    ]);

    await runFollowup({
      followup: q,
      originalQuestion,
      finalReport,
      synthesizer,
      apiKey,
      onEvent: (e) => {
        setTurns((prev) => {
          const copy = [...prev];
          const t = copy[idx];
          if (!t) return copy;
          if (e.type === "text_delta" && e.textDelta) {
            copy[idx] = { ...t, answer: t.answer + e.textDelta };
          } else if (e.type === "status" && e.status) {
            copy[idx] = { ...t, status: e.status };
          } else if (e.type === "error") {
            copy[idx] = {
              ...t,
              status: "failed",
              error: e.error,
            };
          }
          return copy;
        });
      },
    });
    setBusy(false);
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-6 py-4">
        <MessageCircleQuestion className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Ask a follow-up</h2>
      </header>

      <div className="space-y-4 px-6 py-5">
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a clarifying question and the synthesizer will answer using the
            report as context. Single-turn — each follow-up is independent.
          </p>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-md bg-secondary/50 px-3 py-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                You asked
              </span>
              <p className="mt-1">{t.question}</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              {t.status === "writing" && !t.answer && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
              {t.answer && <Markdown>{t.answer}</Markdown>}
              {t.status === "failed" && (
                <p className="text-xs text-destructive">{t.error || "Failed."}</p>
              )}
            </div>
          </div>
        ))}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
            }}
            placeholder="What about… ?"
            rows={2}
            disabled={busy || !apiKey}
            className="flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          />
          <Button onClick={ask} disabled={!draft.trim() || busy || !apiKey}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Ask
          </Button>
        </div>
        {!apiKey && (
          <p className="text-xs text-muted-foreground">
            Lock/unlock not active — reload and re-enter your passphrase.
          </p>
        )}
      </div>
    </section>
  );
}
