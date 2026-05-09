import type { Source } from "@/lib/types";
import type { RunEvent } from "@/lib/providers/anthropic";

export type { RunEvent };

export const GEMINI_RESEARCH_AGENTS = {
  preview: "deep-research-preview-04-2026",
  max: "deep-research-max-preview-04-2026",
} as const;

interface RunArgs {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  tier?: "preview" | "max";
  onEvent: (e: RunEvent) => void;
}

const POLL_INTERVAL_MS = 10_000;
const MAX_DURATION_MS = 30 * 60 * 1000;

interface StartResp {
  interactionId?: string;
  status?: string;
  agent?: string;
  error?: string;
}

interface PollResp {
  status?: string;
  webSearches?: number;
  text?: string;
  sources?: Source[];
  searchQueries?: string[];
  error?: string;
}

/**
 * Gemini Deep Research — submit + poll. The interactions API runs
 * 5–30 min upstream, so to avoid the card sitting empty we extract
 * live progress (search queries, source URLs, partial text) on every
 * poll and dispatch only the deltas to the store. Same shape as the
 * streaming providers from the UI's perspective.
 */
export async function researchGemini({
  question,
  apiKey,
  contextDocs,
  tier,
  onEvent,
}: RunArgs): Promise<void> {
  onEvent({ type: "status", status: "planning" });

  // eslint-disable-next-line no-console
  console.info("[gemini] POST /api/research/gemini/start — starting…");

  let startResp: StartResp;
  try {
    const r = await fetch("/api/research/gemini/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, apiKey, contextDocs, tier }),
    });
    startResp = (await r.json()) as StartResp;
    if (!r.ok || startResp.error) {
      onEvent({
        type: "error",
        error: startResp.error || `HTTP ${r.status}`,
      });
      onEvent({ type: "status", status: "failed" });
      return;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[gemini] start failed:", e);
    onEvent({
      type: "error",
      error:
        e instanceof Error ? `Network error: ${e.message}` : "Network error",
    });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  const interactionId = startResp.interactionId;
  if (!interactionId) {
    onEvent({ type: "error", error: "No interactionId returned" });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  // eslint-disable-next-line no-console
  console.info(
    `[gemini] interaction queued: ${interactionId} (${startResp.status})`,
  );
  onEvent({ type: "status", status: "searching", detail: "submitted" });

  // Track what we've already dispatched so we only emit deltas.
  const seenQueries = new Set<string>();
  const seenSources = new Set<string>();
  let dispatchedTextLen = 0;
  let knownSearches = 0;
  let lastStatus: "searching" | "writing" = "searching";

  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_DURATION_MS) {
    await sleep(POLL_INTERVAL_MS);

    let poll: PollResp;
    try {
      const r = await fetch("/api/research/gemini/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interactionId, apiKey }),
      });
      poll = (await r.json()) as PollResp;
      if (!r.ok || poll.error) {
        if (
          poll.status &&
          poll.status !== "failed" &&
          poll.status !== "cancelled" &&
          poll.status !== "incomplete"
        ) {
          continue;
        }
        onEvent({ type: "error", error: poll.error || `HTTP ${r.status}` });
        onEvent({ type: "status", status: "failed" });
        return;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[gemini] poll failed:", e);
      continue;
    }

    // Emit any new search queries
    if (poll.searchQueries?.length) {
      for (const q of poll.searchQueries) {
        if (!seenQueries.has(q)) {
          seenQueries.add(q);
          onEvent({ type: "search_query", query: q });
        }
      }
    }

    // Emit any new sources
    if (poll.sources?.length) {
      const fresh: Source[] = [];
      for (const s of poll.sources) {
        if (!seenSources.has(s.url)) {
          seenSources.add(s.url);
          fresh.push(s);
        }
      }
      if (fresh.length) onEvent({ type: "search_results", sources: fresh });
    }

    // Emit any new text (partial accumulation while in_progress, or
    // the full final text on completed)
    if (poll.text && poll.text.length > dispatchedTextLen) {
      const delta = poll.text.slice(dispatchedTextLen);
      dispatchedTextLen = poll.text.length;
      if (lastStatus !== "writing") {
        lastStatus = "writing";
        onEvent({ type: "status", status: "writing" });
      }
      onEvent({ type: "text_delta", textDelta: delta });
    }

    // Update searches count + detail
    if (
      typeof poll.webSearches === "number" &&
      poll.webSearches > knownSearches
    ) {
      knownSearches = poll.webSearches;
      if (lastStatus === "searching") {
        onEvent({
          type: "status",
          status: "searching",
          detail: `${knownSearches} search${knownSearches === 1 ? "" : "es"}`,
        });
      }
    }

    if (poll.status === "completed") {
      onEvent({
        type: "status",
        status: "done",
        detail: `${knownSearches} search${knownSearches === 1 ? "" : "es"}`,
      });
      onEvent({
        type: "done",
        usage: { inputTokens: 0, outputTokens: 0, webSearches: knownSearches },
      });
      return;
    }

    if (
      poll.status === "failed" ||
      poll.status === "cancelled" ||
      poll.status === "incomplete"
    ) {
      onEvent({
        type: "error",
        error: poll.error || `Gemini returned status: ${poll.status}`,
      });
      onEvent({ type: "status", status: "failed" });
      return;
    }
    // in_progress / requires_action — keep polling
  }

  onEvent({
    type: "error",
    error: `Gemini deep research timed out after ${Math.round(MAX_DURATION_MS / 60000)} minutes`,
  });
  onEvent({ type: "status", status: "failed" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
