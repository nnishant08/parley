import { NextRequest } from "next/server";
import {
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserMessage,
} from "@/lib/prompts/synthesis-system";
import type { Critique, Provider } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface Body {
  question: string;
  reports: Array<{ provider: Provider; markdown: string }>;
  critiques: Critique[];
  synthesizer: Provider; // step 14 makes this a real picker; default is anthropic.
  apiKey: string;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const SYNTH_MODELS: Record<Provider, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-5.5",
  gemini: "gemini-2.5-pro",
  mistral: "mistral-medium-latest",
};

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log("[proxy/synthesize] POST received");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const { question, reports, critiques, synthesizer, apiKey } = body;
  if (!question || !Array.isArray(reports) || !apiKey) {
    return new Response("Missing fields", { status: 400 });
  }

  const userMsg = buildSynthesisUserMessage({ question, reports, critiques });

  // Step 8 hardcodes the Anthropic synthesis path — it's the spec
  // default and also the highest-quality long-form writer of the
  // four. Step 14 will add the real synthesizer picker that branches
  // here on `synthesizer` and routes through the right SDK + streaming
  // method for OpenAI / Gemini / Mistral.
  if (synthesizer !== "anthropic") {
    return new Response(
      `Synthesizer ${synthesizer} not implemented yet (step 14 will land the picker; for now use synthesizer="anthropic")`,
      { status: 501 },
    );
  }

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
        model: SYNTH_MODELS.anthropic,
        max_tokens: 16000,
        system: SYNTHESIS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
        stream: true,
      }),
      signal: req.signal,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/synthesize] fetch failed:", e);
    return new Response(
      e instanceof Error ? e.message : "Anthropic fetch failed",
      { status: 502 },
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[proxy/synthesize] Anthropic responded ${upstream.status} after ${Date.now() - t0}ms`,
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || `Anthropic returned HTTP ${upstream.status}`, {
      status: upstream.status,
      headers: { "content-type": "text/plain" },
    });
  }

  // Manual pump for chunk-level visibility, same pattern as the
  // claude stage-1 proxy.
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
            controller.enqueue(value);
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `[proxy/synthesize] stream done — ${chunkCount} chunks, ${totalBytes} bytes, ${Date.now() - t0}ms`,
        );
        controller.close();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[proxy/synthesize] pump error:", e);
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
