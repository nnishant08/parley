import { NextRequest } from "next/server";
import { Mistral } from "@mistralai/mistralai";
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MODEL = "mistral-medium-latest";

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
  console.log("[proxy/mistral] POST received");

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

  const client = new Mistral({ apiKey });

  // eslint-disable-next-line no-console
  console.log("[proxy/mistral] starting conversation stream");

  let upstream;
  try {
    upstream = await client.beta.conversations.startStream({
      inputs: buildUserMessage(question, contextDocs),
      model: MODEL,
      instructions: RESEARCH_SYSTEM_PROMPT,
      tools: [{ type: "web_search" }],
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/mistral] startStream failed:", e);
    const msg = e instanceof Error ? e.message : "Mistral startStream failed";
    return new Response(msg, { status: 502 });
  }

  // Re-emit each Mistral SDK event as SSE for the browser. We control
  // the wire format ourselves (mirrors anthropic's pass-through) so the
  // client uses the same parseSseStream helper for both.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let firstChunkLogged = false;
      let count = 0;
      try {
        for await (const ev of upstream) {
          count++;
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            // eslint-disable-next-line no-console
            console.log(
              `[proxy/mistral] first event @ ${Date.now() - t0}ms (${ev.event})`,
            );
          }
          const line = `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
        // eslint-disable-next-line no-console
        console.log(
          `[proxy/mistral] stream done — ${count} events, ${Date.now() - t0}ms total`,
        );
        controller.close();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[proxy/mistral] pump error:", e);
        const errLine = `event: proxy.error\ndata: ${JSON.stringify({ message: e instanceof Error ? e.message : String(e) })}\n\n`;
        try {
          controller.enqueue(encoder.encode(errLine));
        } catch {
          /* ignore */
        }
        controller.error(e);
      }
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
