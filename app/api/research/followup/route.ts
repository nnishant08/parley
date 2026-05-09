import { NextRequest } from "next/server";
import type { Provider } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const FOLLOWUP_SYSTEM_PROMPT = `You are answering a follow-up question on a research report you just produced. Use the report as your primary source. Be concise and specific — short paragraphs, direct answers, citations only when needed. If the report doesn't cover the follow-up, say so explicitly rather than speculating.`;

interface Body {
  followup: string;
  originalQuestion: string;
  finalReport: string;
  synthesizer: Provider;
  apiKey: string;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-4-7";

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const { followup, originalQuestion, finalReport, synthesizer, apiKey } = body;
  if (!followup || !apiKey || !finalReport) {
    return new Response("Missing fields", { status: 400 });
  }

  // Step 12 hardcodes Anthropic — same shape as synthesize. Step 14
  // generalizes both to the user-picked synthesizer.
  if (synthesizer !== "anthropic") {
    return new Response(
      `Followup against ${synthesizer} not implemented yet (step 14)`,
      { status: 501 },
    );
  }

  const userMsg = [
    `Original question: ${originalQuestion}`,
    "",
    "==== FINAL REPORT ====",
    finalReport,
    "==== END REPORT ====",
    "",
    `Follow-up: ${followup}`,
  ].join("\n");

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
        max_tokens: 4096,
        system: FOLLOWUP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
        stream: true,
      }),
      signal: req.signal,
    });
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : "Upstream fetch failed",
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || `HTTP ${upstream.status}`, {
      status: upstream.status,
      headers: { "content-type": "text/plain" },
    });
  }

  // Pipe SSE through unchanged — same pattern as synthesize.
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
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
