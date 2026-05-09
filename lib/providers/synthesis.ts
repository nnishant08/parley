import { parseSseStream } from "@/lib/sse";
import type { Critique, Provider } from "@/lib/types";

export interface SynthesisEvent {
  type: "status" | "text_delta" | "done" | "error";
  status?: "writing" | "done" | "failed";
  textDelta?: string;
  error?: string;
}

interface RunArgs {
  question: string;
  reports: Array<{ provider: Provider; markdown: string }>;
  critiques: Critique[];
  synthesizer: Provider;
  apiKey: string;
  onEvent: (e: SynthesisEvent) => void;
}

/**
 * Streams the synthesis call through /api/research/synthesize and
 * dispatches text deltas as the final report is written.
 *
 * Routes to the chosen synthesizer (any of the 4 providers).
 * Server side translates each provider's stream into Anthropic-shaped
 * SSE so this client can stay simple.
 */
export async function runSynthesis({
  question,
  reports,
  critiques,
  synthesizer,
  apiKey,
  onEvent,
}: RunArgs): Promise<void> {
  onEvent({ type: "status", status: "writing" });

  let resp: Response;
  try {
    resp = await fetch("/api/research/synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        reports,
        critiques,
        synthesizer,
        apiKey,
      }),
    });
  } catch (e) {
    onEvent({
      type: "error",
      error: e instanceof Error ? e.message : "Network error",
    });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`;
    try {
      const text = await resp.text();
      if (text) detail = `${detail}: ${text.slice(0, 300)}`;
    } catch {
      /* ignore */
    }
    onEvent({ type: "error", error: detail });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  // The server route emits Anthropic-shaped SSE events regardless of
  // which synthesizer ran upstream (see lib/sseEmit.ts), so this
  // parser handles all four providers uniformly.
  try {
    for await (const msg of parseSseStream(resp.body)) {
      if (msg.event === "ping" || !msg.data) continue;
      let payload: { type?: string } & Record<string, unknown>;
      try {
        payload = JSON.parse(msg.data);
      } catch {
        continue;
      }

      if (payload.type === "content_block_delta") {
        const e = payload as unknown as {
          delta: { type: string; text?: string };
        };
        if (e.delta.type === "text_delta" && typeof e.delta.text === "string") {
          onEvent({ type: "text_delta", textDelta: e.delta.text });
        }
      } else if (payload.type === "message_stop") {
        onEvent({ type: "status", status: "done" });
        onEvent({ type: "done" });
      } else if (payload.type === "error") {
        const m = payload as unknown as { error?: { message?: string } };
        onEvent({ type: "error", error: m.error?.message ?? "Stream error" });
        onEvent({ type: "status", status: "failed" });
      }
    }
  } catch (e) {
    onEvent({
      type: "error",
      error: e instanceof Error ? e.message : "Stream parse error",
    });
    onEvent({ type: "status", status: "failed" });
  }
}
