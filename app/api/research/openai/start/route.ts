import { NextRequest } from "next/server";
import OpenAI from "openai";
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "o3-deep-research-2025-06-26";
const ALT_MODEL = "o4-mini-deep-research-2025-06-26";

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

  const model = tier === "o4-mini" ? ALT_MODEL : DEFAULT_MODEL;
  // Bump retries from the SDK default of 2 → 6. Deep-research orgs
  // routinely hit transient TPM caps (the prompt is ~30k tokens at
  // ingestion); the SDK honors the upstream Retry-After header on
  // 429s with exponential backoff, so this just rides them out
  // instead of surfacing a flake to the user.
  const client = new OpenAI({ apiKey, maxRetries: 6 });

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
    const message = e instanceof Error ? e.message : "OpenAI call failed";
    // OpenAI's verified-org guard surfaces as a specific 403; pass that
    // through clearly so the UI can render an actionable message.
    const status =
      typeof (e as { status?: number }).status === "number"
        ? (e as { status: number }).status
        : 502;
    return Response.json({ error: message }, { status });
  }
}
