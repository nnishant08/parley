import type { Source } from "@/lib/types";
import type { RunEvent } from "@/lib/providers/anthropic";

export type { RunEvent };

export const OPENAI_RESEARCH_MODELS = {
  o3: "o3-deep-research-2025-06-26",
  "o4-mini": "o4-mini-deep-research-2025-06-26",
} as const;

interface RunArgs {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  tier?: "o3" | "o4-mini";
  onEvent: (e: RunEvent) => void;
}

const POLL_INTERVAL_MS = 10_000;
const MAX_DURATION_MS = 30 * 60 * 1000;

interface StartResp {
  responseId?: string;
  status?: string;
  model?: string;
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
 * OpenAI Deep Research — submit + poll. The Responses API runs 5–30
 * min upstream; polling extracts whatever is available now (search
 * queries, source URLs, partial text from the in-flight message)
 * and we dispatch only the deltas to the store. Card stays alive
 * with live activity instead of empty for half an hour.
 */
export async function researchOpenAI({
  question,
  apiKey,
  contextDocs,
  tier,
  onEvent,
}: RunArgs): Promise<void> {
  onEvent({ type: "status", status: "planning" });

  // eslint-disable-next-line no-console
  console.info("[openai] POST /api/research/openai/start — starting…");

  let startResp: StartResp;
  try {
    const r = await fetch("/api/research/openai/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, apiKey, contextDocs, tier }),
    });
    startResp = (await r.json()) as StartResp;
    if (!r.ok || startResp.error) {
      const msg = startResp.error || `HTTP ${r.status}`;
      const hint =
        r.status === 403
          ? " — Deep Research requires a verified org on your OpenAI account."
          : "";
      onEvent({ type: "error", error: `${msg}${hint}` });
      onEvent({ type: "status", status: "failed" });
      return;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[openai] start failed:", e);
    onEvent({
      type: "error",
      error:
        e instanceof Error ? `Network error: ${e.message}` : "Network error",
    });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  const responseId = startResp.responseId;
  if (!responseId) {
    onEvent({ type: "error", error: "No responseId returned" });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  // eslint-disable-next-line no-console
  console.info(`[openai] response queued: ${responseId} (${startResp.status})`);
  onEvent({ type: "status", status: "searching", detail: "submitted" });

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
      const r = await fetch("/api/research/openai/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responseId, apiKey }),
      });
      poll = (await r.json()) as PollResp;
      if (!r.ok || poll.error) {
        const msg = poll.error || `HTTP ${r.status}`;
        onEvent({ type: "error", error: msg });
        onEvent({ type: "status", status: "failed" });
        return;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[openai] poll failed:", e);
      continue;
    }

    if (poll.searchQueries?.length) {
      for (const q of poll.searchQueries) {
        if (!seenQueries.has(q)) {
          seenQueries.add(q);
          onEvent({ type: "search_query", query: q });
        }
      }
    }

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

    if (poll.text && poll.text.length > dispatchedTextLen) {
      const delta = poll.text.slice(dispatchedTextLen);
      dispatchedTextLen = poll.text.length;
      if (lastStatus !== "writing") {
        lastStatus = "writing";
        onEvent({ type: "status", status: "writing" });
      }
      onEvent({ type: "text_delta", textDelta: delta });
    }

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
        error: `OpenAI returned status: ${poll.status}`,
      });
      onEvent({ type: "status", status: "failed" });
      return;
    }
    // queued / in_progress — keep polling
  }

  onEvent({
    type: "error",
    error: `OpenAI deep research timed out after ${Math.round(MAX_DURATION_MS / 60000)} minutes`,
  });
  onEvent({ type: "status", status: "failed" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
