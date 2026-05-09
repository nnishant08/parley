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
  error?: string;
}

/**
 * Gemini Deep Research follows a submit-and-poll pattern (the agent
 * runs minutes, not seconds). Mirrors lib/providers/openai.ts almost
 * exactly — only the proxy URLs and the field names differ.
 *
 * The Interactions API is in beta; if Google ships a breaking schema
 * change, this and the /api/research/gemini/poll extractor are the
 * places to fix.
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

  const startedAt = Date.now();
  let knownSearches = 0;

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
        // status field may still indicate non-terminal — check it
        if (
          poll.status &&
          poll.status !== "failed" &&
          poll.status !== "cancelled" &&
          poll.status !== "incomplete"
        ) {
          continue; // transient; keep polling
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

    if (
      typeof poll.webSearches === "number" &&
      poll.webSearches > knownSearches
    ) {
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
