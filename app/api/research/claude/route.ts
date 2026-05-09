import { NextRequest } from "next/server";
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";

export const runtime = "nodejs";
// Pro-only headroom; Hobby caps at 60s. Local dev has no cap.
export const maxDuration = 300;
// Force dynamic to avoid any static optimization that could buffer.
export const dynamic = "force-dynamic";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-4-7";

interface Body {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
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

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log("[proxy/claude] POST received");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const { question, apiKey, contextDocs } = body;
  if (!question || !apiKey) {
    return new Response("Missing question or apiKey", { status: 400 });
  }

  // eslint-disable-next-line no-console
  console.log("[proxy/claude] forwarding to Anthropic");

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
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
      signal: req.signal,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/claude] fetch to Anthropic failed:", e);
    return new Response(
      e instanceof Error ? e.message : "Anthropic fetch failed",
      { status: 502 },
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[proxy/claude] Anthropic responded ${upstream.status} ${upstream.statusText} after ${Date.now() - t0}ms`,
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error(`[proxy/claude] non-OK from Anthropic: ${text.slice(0, 200)}`);
    return new Response(text || `Anthropic returned HTTP ${upstream.status}`, {
      status: upstream.status,
      headers: { "content-type": "text/plain" },
    });
  }

  // Manual pump: read each chunk and re-enqueue. This avoids any
  // pass-through buffering quirks in Next.js's Response handling and
  // gives us a hook to log every chunk so we can prove the stream is
  // flowing.
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let chunkCount = 0;
      let totalBytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunkCount++;
            totalBytes += value.byteLength;
            if (chunkCount === 1) {
              // eslint-disable-next-line no-console
              console.log(
                `[proxy/claude] first chunk @ ${Date.now() - t0}ms (${value.byteLength} bytes)`,
              );
            }
            controller.enqueue(value);
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `[proxy/claude] stream done — ${chunkCount} chunks, ${totalBytes} bytes, ${Date.now() - t0}ms total`,
        );
        controller.close();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[proxy/claude] pump error:", e);
        controller.error(e);
      }
    },
    cancel() {
      // Browser disconnected — abort the upstream read.
      reader.cancel().catch(() => {
        /* ignore */
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
