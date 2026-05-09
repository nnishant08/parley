import { NextRequest } from "next/server";
import { streamChat } from "@/lib/synthesizer";
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

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const { followup, originalQuestion, finalReport, synthesizer, apiKey } = body;
  if (!followup || !apiKey || !finalReport || !synthesizer) {
    return new Response("Missing fields", { status: 400 });
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

  const stream = streamChat({
    provider: synthesizer,
    apiKey,
    systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
    userMessage: userMsg,
    maxTokens: 4096,
    signal: req.signal,
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
