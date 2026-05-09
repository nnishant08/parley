import { parseSseStream } from "@/lib/sse";
import type { Source } from "@/lib/types";
import type { RunEvent } from "@/lib/providers/anthropic";

// Re-export the shared event shape so the page can consume both providers
// uniformly.
export type { RunEvent };

export const MISTRAL_RESEARCH_MODEL = "mistral-medium-latest";

interface RunArgs {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  onEvent: (e: RunEvent) => void;
}

/**
 * Streaming research call against Mistral Medium 3.5 with the
 * web_search built-in tool, proxied through /api/research/mistral.
 *
 * Mistral has no Deep Research API — this is the "approximated" path
 * called out in the spec (UI labels the card accordingly). Quality
 * tends to be shallower than Claude's web-search runs.
 *
 * Mistral's stream emits typed conversation events (message.output.delta,
 * tool.execution.started/done, etc). We translate them into the shared
 * RunEvent shape so the run page treats both providers the same.
 */
export async function researchMistral({
  question,
  apiKey,
  contextDocs,
  onEvent,
}: RunArgs): Promise<void> {
  onEvent({ type: "status", status: "planning" });

  // eslint-disable-next-line no-console
  console.info("[mistral] POST /api/research/mistral — starting…");

  let resp: Response;
  try {
    resp = await fetch("/api/research/mistral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, apiKey, contextDocs }),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[mistral] fetch failed:", e);
    onEvent({
      type: "error",
      error:
        e instanceof Error
          ? `Network error: ${e.message}`
          : "Network error reaching the proxy route",
    });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  // eslint-disable-next-line no-console
  console.info(`[mistral] response status ${resp.status} ${resp.statusText}`);

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

  let firstTextSeen = false;
  let outputTokens = 0;
  let webSearches = 0;

  try {
    for await (const msg of parseSseStream(resp.body)) {
      if (!msg.event || !msg.data) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(msg.data);
      } catch {
        continue;
      }

      switch (msg.event) {
        case "conversation.response.started": {
          // upstream is processing — leave status at planning until we
          // see the first concrete activity (search or text).
          break;
        }

        case "tool.execution.started": {
          const name =
            typeof data.name === "string" ? data.name : undefined;
          if (name === "web_search") {
            webSearches++;
            onEvent({ type: "status", status: "searching" });
            // arguments arrive as a JSON string with the query
            if (typeof data.arguments === "string") {
              try {
                const parsed = JSON.parse(data.arguments) as { query?: string };
                if (typeof parsed.query === "string") {
                  onEvent({ type: "search_query", query: parsed.query });
                }
              } catch {
                /* arguments may be empty on start */
              }
            }
          }
          break;
        }

        case "tool.execution.delta": {
          // arguments stream as JSON deltas — Mistral may send them
          // either piecewise or as a complete JSON. Try parsing for a
          // query each delta.
          if (typeof data.arguments === "string" && data.arguments) {
            try {
              const parsed = JSON.parse(data.arguments) as { query?: string };
              if (typeof parsed.query === "string") {
                onEvent({ type: "search_query", query: parsed.query });
              }
            } catch {
              /* partial */
            }
          }
          break;
        }

        case "tool.execution.done": {
          // info MAY contain references but the API doesn't guarantee
          // a uniform shape; sources surface via tool_reference chunks
          // in subsequent message.output.delta events.
          break;
        }

        case "message.output.delta": {
          if (!firstTextSeen) {
            firstTextSeen = true;
            onEvent({ type: "status", status: "writing" });
          }
          const content = data.content;
          if (typeof content === "string") {
            onEvent({ type: "text_delta", textDelta: content });
          } else if (content && typeof content === "object") {
            const c = content as Record<string, unknown>;
            if (c.type === "text" && typeof c.text === "string") {
              onEvent({ type: "text_delta", textDelta: c.text });
            } else if (c.type === "tool_reference") {
              const url = typeof c.url === "string" ? c.url : undefined;
              if (url) {
                const sources: Source[] = [
                  {
                    url,
                    title: typeof c.title === "string" ? c.title : undefined,
                  },
                ];
                onEvent({ type: "search_results", sources });
              }
            }
            // think / image / document chunks are ignored for now
          }
          break;
        }

        case "conversation.response.done": {
          // Mistral's done event carries usage if available
          const usage = (data as { usage?: { completionTokens?: number } })
            .usage;
          if (usage && typeof usage.completionTokens === "number") {
            outputTokens = usage.completionTokens;
          }
          onEvent({
            type: "status",
            status: "done",
            detail: `${webSearches} search${webSearches === 1 ? "" : "es"}${outputTokens ? ` · ${outputTokens.toLocaleString()} tokens out` : ""}`,
          });
          onEvent({
            type: "done",
            usage: { inputTokens: 0, outputTokens, webSearches },
          });
          break;
        }

        case "conversation.response.error": {
          const message =
            typeof data.message === "string" ? data.message : "Mistral error";
          onEvent({ type: "error", error: message });
          onEvent({ type: "status", status: "failed" });
          break;
        }

        case "proxy.error": {
          const message =
            typeof data.message === "string"
              ? data.message
              : "Proxy stream error";
          onEvent({ type: "error", error: message });
          onEvent({ type: "status", status: "failed" });
          break;
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[mistral] stream parse error:", e);
    onEvent({
      type: "error",
      error: e instanceof Error ? e.message : "Stream parse error",
    });
    onEvent({ type: "status", status: "failed" });
  }
}
