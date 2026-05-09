import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";
import { parseSseStream } from "@/lib/sse";
import type { Source } from "@/lib/types";

export const ANTHROPIC_RESEARCH_MODEL = "claude-opus-4-7";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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

function buildUserMessage(
  question: string,
  contextDocs?: { name: string; text: string }[],
): string {
  if (!contextDocs?.length) return question;
  const doclets = contextDocs
    .map((d) => `<document name="${d.name}">\n${d.text}\n</document>`)
    .join("\n\n");
  return `${doclets}\n\nQuestion: ${question}`;
}

/**
 * Browser-direct streaming research call against Claude Opus 4.7
 * with the web_search_20260209 tool.
 *
 * We hit the API with raw fetch (no SDK) for two reasons:
 *   (1) the SDK pulls in node:fs/path via its credential-chain helpers,
 *       which webpack 5 can't bundle for the browser; and
 *   (2) keeping browser-direct callers SDK-free means one consistent
 *       fetch+SSE pattern across Claude and Mistral.
 *
 * The Anthropic API supports browser CORS only when we send the
 * `anthropic-dangerous-direct-browser-access: true` header. That's the
 * header the SDK's `dangerouslyAllowBrowser` flag toggles internally.
 */
export async function researchClaude({
  question,
  apiKey,
  contextDocs,
  signal,
  onEvent,
}: RunArgs): Promise<void> {
  onEvent({ type: "status", status: "planning" });

  // Buffer partial JSON for in-flight server_tool_use blocks so we can
  // surface the search query once it finishes streaming.
  const toolInputBuffers = new Map<number, string>();

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_RESEARCH_MODEL,
        max_tokens: 16000,
        system: RESEARCH_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildUserMessage(question, contextDocs) },
        ],
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 10 },
        ],
        stream: true,
      }),
    });
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") return;
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
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = `${detail}: ${j.error.message}`;
      else if (text) detail = `${detail}: ${text.slice(0, 200)}`;
    } catch {
      /* fall through */
    }
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
    onEvent({
      type: "error",
      error: e instanceof Error ? e.message : "Stream parse error",
    });
    onEvent({ type: "status", status: "failed" });
  }
}
