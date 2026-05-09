import { parseSseStream } from "@/lib/sse";
import type { Source } from "@/lib/types";

export const ANTHROPIC_RESEARCH_MODEL = "claude-opus-4-7";

export type RunStatus =
  | "planning"
  | "searching"
  | "writing"
  | "done"
  | "failed";

export interface RunEvent {
  type:
    | "status"
    | "text_delta"
    | "search_query"
    | "search_results"
    | "done"
    | "error";
  status?: RunStatus;
  detail?: string;
  textDelta?: string;
  query?: string;
  sources?: Source[];
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; webSearches: number };
}

interface RunArgs {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  signal?: AbortSignal;
  onEvent: (e: RunEvent) => void;
}

/**
 * Streaming research call against Claude Opus 4.7 with the
 * web_search_20260209 tool, proxied through our Next.js route at
 * /api/research/claude.
 *
 * Why proxy instead of browser-direct: the Anthropic browser CORS path
 * (anthropic-dangerous-direct-browser-access) hung on at least one
 * common dev setup — likely a preflight blocked by an extension or
 * corporate proxy. Routing through Next.js sidesteps that entirely.
 * Trade-off: on Vercel Hobby, function timeout is 60s (so research
 * calls longer than that will fail in production). Mitigations: typical
 * Claude+web_search runs are 30–60s, retry surfaces the rest, and
 * upgrading to Pro gives 300s.
 */
export async function researchClaude({
  question,
  apiKey,
  contextDocs,
  signal,
  onEvent,
}: RunArgs): Promise<void> {
  onEvent({ type: "status", status: "planning" });

  // eslint-disable-next-line no-console
  console.info("[claude] POST /api/research/claude — starting…");

  const toolInputBuffers = new Map<number, string>();

  let resp: Response;
  try {
    resp = await fetch("/api/research/claude", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, apiKey, contextDocs }),
    });
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") return;
    // eslint-disable-next-line no-console
    console.error("[claude] fetch failed:", e);
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
  console.info(`[claude] response status ${resp.status} ${resp.statusText}`);

  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`;
    try {
      const text = await resp.text();
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j.error?.message) detail = `${detail}: ${j.error.message}`;
        else if (text) detail = `${detail}: ${text.slice(0, 300)}`;
      } catch {
        if (text) detail = `${detail}: ${text.slice(0, 300)}`;
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.error("[claude] non-OK response:", detail);
    onEvent({ type: "error", error: detail });
    onEvent({ type: "status", status: "failed" });
    return;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let webSearches = 0;
  let firstTextSeen = false;

  try {
    for await (const msg of parseSseStream(resp.body, signal)) {
      if (msg.event === "ping" || !msg.data) continue;
      let payload: { type?: string } & Record<string, unknown>;
      try {
        payload = JSON.parse(msg.data);
      } catch {
        continue;
      }

      switch (payload.type) {
        case "message_start": {
          const m = payload as unknown as {
            message?: { usage?: { input_tokens?: number } };
          };
          if (m.message?.usage?.input_tokens)
            inputTokens += m.message.usage.input_tokens;
          break;
        }
        case "content_block_start": {
          const e = payload as unknown as {
            index: number;
            content_block: { type: string } & Record<string, unknown>;
          };
          const cb = e.content_block;
          if (cb.type === "server_tool_use" && cb.name === "web_search") {
            onEvent({ type: "status", status: "searching" });
            toolInputBuffers.set(e.index, "");
          } else if (cb.type === "web_search_tool_result") {
            const results =
              (cb.content as Array<Record<string, unknown>> | undefined) || [];
            const sources: Source[] = [];
            for (const r of results) {
              if (
                r &&
                r.type === "web_search_result" &&
                typeof r.url === "string"
              ) {
                sources.push({
                  url: r.url,
                  title: typeof r.title === "string" ? r.title : undefined,
                });
              }
            }
            if (sources.length) onEvent({ type: "search_results", sources });
          } else if (cb.type === "text") {
            if (!firstTextSeen) {
              firstTextSeen = true;
              onEvent({ type: "status", status: "writing" });
            }
          }
          break;
        }
        case "content_block_delta": {
          const e = payload as unknown as {
            index: number;
            delta: { type: string } & Record<string, unknown>;
          };
          const delta = e.delta;
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            if (!firstTextSeen) {
              firstTextSeen = true;
              onEvent({ type: "status", status: "writing" });
            }
            onEvent({ type: "text_delta", textDelta: delta.text as string });
          } else if (
            delta.type === "input_json_delta" &&
            typeof delta.partial_json === "string"
          ) {
            const idx = e.index;
            if (toolInputBuffers.has(idx)) {
              toolInputBuffers.set(
                idx,
                (toolInputBuffers.get(idx) ?? "") +
                  (delta.partial_json as string),
              );
            }
          }
          break;
        }
        case "content_block_stop": {
          const e = payload as unknown as { index: number };
          const buf = toolInputBuffers.get(e.index);
          if (buf !== undefined) {
            toolInputBuffers.delete(e.index);
            try {
              const parsed = JSON.parse(buf) as { query?: string };
              if (typeof parsed.query === "string") {
                webSearches++;
                onEvent({ type: "search_query", query: parsed.query });
              }
            } catch {
              /* malformed partial — ignore */
            }
          }
          break;
        }
        case "message_delta": {
          const m = payload as unknown as {
            usage?: { output_tokens?: number };
          };
          if (typeof m.usage?.output_tokens === "number")
            outputTokens = m.usage.output_tokens;
          break;
        }
        case "message_stop": {
          onEvent({
            type: "status",
            status: "done",
            detail: `${webSearches} search${webSearches === 1 ? "" : "es"} · ${outputTokens.toLocaleString()} tokens out`,
          });
          onEvent({
            type: "done",
            usage: { inputTokens, outputTokens, webSearches },
          });
          break;
        }
        case "error": {
          const m = payload as unknown as { error?: { message?: string } };
          onEvent({
            type: "error",
            error: m.error?.message ?? "Stream error",
          });
          onEvent({ type: "status", status: "failed" });
          break;
        }
      }
    }
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") return;
    // eslint-disable-next-line no-console
    console.error("[claude] stream parse error:", e);
    onEvent({
      type: "error",
      error: e instanceof Error ? e.message : "Stream parse error",
    });
    onEvent({ type: "status", status: "failed" });
  }
}
