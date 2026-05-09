import { NextRequest } from "next/server";
import OpenAI from "openai";
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Switched default to o4-mini per user preference: ~$1.50/run vs ~$4/run
// for o3, with deep-research depth that's still substantially better than
// the streaming-w/-web-search alternative. Pass tier="o3" to get the
// pricier high-quality model.
const DEFAULT_MODEL = "o4-mini-deep-research-2025-06-26";
const O3_MODEL = "o3-deep-research-2025-06-26";

interface Body {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  tier?: "o3" | "o4-mini";
}

function buildUserText(
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
  console.log("[proxy/openai/start] POST received");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { question, apiKey, contextDocs, tier } = body;
  if (!question || !apiKey) {
    return Response.json(
      { error: "Missing question or apiKey" },
      { status: 400 },
    );
  }

  const model = tier === "o3" ? O3_MODEL : DEFAULT_MODEL;
  // Bump retries from the SDK default of 2 → 10. Deep-research orgs
  // routinely hit transient TPM caps (each call counts ~30k tokens
  // against the per-minute limit, default 200k); the SDK honors the
  // upstream Retry-After header with exponential backoff. Ten retries
  // bridges ~30+ seconds of waiting which is usually enough to cross
  // a minute boundary on a heavily-loaded org.
  const client = new OpenAI({ apiKey, maxRetries: 10 });

  try {
    const resp = await client.responses.create({
      model,
      // input is a message array per OpenAI's Responses API.
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: RESEARCH_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: buildUserText(question, contextDocs) },
          ],
        },
      ],
      tools: [{ type: "web_search_preview" }],
      // reasoning.summary requires a verified OpenAI org. Skipping it
      // keeps the run available to all keys; the model still reasons,
      // we just don't get the human-readable summary back.
      background: true,
    });

    // eslint-disable-next-line no-console
    console.log(
      `[proxy/openai/start] queued response ${resp.id} (status=${resp.status}) in ${Date.now() - t0}ms`,
    );
    return Response.json({ responseId: resp.id, status: resp.status, model });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/openai/start] OpenAI call failed:", e);
    const rawMessage = e instanceof Error ? e.message : "OpenAI call failed";
    const upstreamStatus =
      typeof (e as { status?: number }).status === "number"
        ? (e as { status: number }).status
        : 502;

    // If we still see a 429 after 10 retries, it's a sustained TPM
    // saturation on the user's org — not a transient blip. Reword
    // the message so the user knows it's a wait-it-out problem,
    // not a config bug.
    let message = rawMessage;
    if (upstreamStatus === 429 || /rate limit reached|tokens per min/i.test(rawMessage)) {
      message =
        "OpenAI rate limit (TPM) — your org's o3-deep-research is over its tokens-per-minute cap. Each run uses ~30k tokens against your limit. Wait ~60s before retrying, or upgrade your OpenAI tier. Original error: " +
        rawMessage;
    }
    return Response.json({ error: message }, { status: upstreamStatus });
  }
}
