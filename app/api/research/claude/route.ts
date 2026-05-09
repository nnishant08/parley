import { NextRequest } from "next/server";
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";

export const runtime = "nodejs";
// Pro-only headroom; Hobby caps at 60s. Local dev has no cap.
export const maxDuration = 300;

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

  const upstream = await fetch(ANTHROPIC_URL, {
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

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || `Anthropic returned HTTP ${upstream.status}`, {
      status: upstream.status,
      headers: { "content-type": "text/plain" },
    });
  }

  // Pipe SSE straight back to the browser. We don't transform; the
  // client already has its own SSE parser.
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
