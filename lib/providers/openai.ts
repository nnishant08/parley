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
const MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes

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
  error?: string;
}

/**
 * OpenAI Deep Research follows a submit-and-poll pattern (the upstream
 * job runs 5–30 minutes), so unlike Claude/Mistral we don't stream
 * tokens — we stay on a "searching" status until OpenAI marks the
 * response completed, then dispatch the full markdown + sources at
 * once. Web-search count updates on each poll so the user sees
 * progress.
 *
 * Verified-org gate: OpenAI's deep research models 403 if the user's
 * org isn't verified. The error path surfaces the actual API message
 * so the user sees an actionable hint, not a generic failure.
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
      // Hint specifically at the verified-org gate when we see a 403.
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

  const startedAt = Date.now();
  let knownSearches = 0;

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
      // single transient failure shouldn't kill the run; loop and retry
      continue;
    }

    if (typeof poll.webSearches === "number" && poll.webSearches > knownSearches) {
      knownSearches = poll.webSearches;
      onEvent({
        type: "status",
        status: "searching",
        detail: `${knownSearches} search${knownSearches === 1 ? "" : "es"}`,
      });
    }

    if (poll.status === "completed") {
      onEvent({ type: "status", status: "writing" });
      if (poll.sources?.length) onEvent({ type: "search_results", sources: poll.sources });
      if (poll.text) onEvent({ type: "text_delta", textDelta: poll.text });
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
    // status is queued / in_progress — keep polling
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
