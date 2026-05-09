import { NextRequest } from "next/server";
import {
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserMessage,
} from "@/lib/prompts/synthesis-system";
import { streamChat } from "@/lib/synthesizer";
import type { Critique, Provider } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface Body {
  question: string;
  reports: Array<{ provider: Provider; markdown: string }>;
  critiques: Critique[];
  synthesizer: Provider;
  apiKey: string;
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line no-console
  console.log("[proxy/synthesize] POST received");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const { question, reports, critiques, synthesizer, apiKey } = body;
  if (!question || !Array.isArray(reports) || !apiKey || !synthesizer) {
    return new Response("Missing fields", { status: 400 });
  }

  // eslint-disable-next-line no-console
  console.log(`[proxy/synthesize] synthesizer=${synthesizer}`);

  const userMsg = buildSynthesisUserMessage({ question, reports, critiques });

  const stream = streamChat({
    provider: synthesizer,
    apiKey,
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    userMessage: userMsg,
    maxTokens: 16000,
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
