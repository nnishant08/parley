import { parseSseStream } from "@/lib/sse";
import type { Provider } from "@/lib/types";

export interface FollowupEvent {
  type: "status" | "text_delta" | "done" | "error";
  status?: "writing" | "done" | "failed";
  textDelta?: string;
  error?: string;
}

export async function runFollowup({
  followup,
  originalQuestion,
  finalReport,
  synthesizer,
  apiKey,
  onEvent,
}: {
  followup: string;
  originalQuestion: string;
  finalReport: string;
  synthesizer: Provider;
  apiKey: string;
  onEvent: (e: FollowupEvent) => void;
}): Promise<void> {
  onEvent({ type: "status", status: "writing" });

  let resp: Response;
  try {
    resp = await fetch("/api/research/followup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        followup,
        originalQuestion,
        finalReport,
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
        const e = payload as unknown as { delta: { type: string; text?: string } };
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
