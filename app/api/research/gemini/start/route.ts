import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/prompts/research-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pinned snapshots — Interactions API is in beta; spec calls out pinning.
const DEFAULT_AGENT = "deep-research-preview-04-2026";
const MAX_AGENT = "deep-research-max-preview-04-2026";

interface Body {
  question: string;
  apiKey: string;
  contextDocs?: { name: string; text: string }[];
  tier?: "preview" | "max";
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
  console.log("[proxy/gemini/start] POST received");

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

  const agent = tier === "max" ? MAX_AGENT : DEFAULT_AGENT;
  const ai = new GoogleGenAI({ apiKey });

  try {
    const interaction = await ai.interactions.create({
      agent,
      input: buildUserText(question, contextDocs),
      system_instruction: RESEARCH_SYSTEM_PROMPT,
      background: true,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[proxy/gemini/start] queued interaction ${interaction.id} (status=${interaction.status}) in ${Date.now() - t0}ms`,
    );
    return Response.json({
      interactionId: interaction.id,
      status: interaction.status,
      agent,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/gemini/start] create failed:", e);
    const message = e instanceof Error ? e.message : "Gemini call failed";
    const status =
      typeof (e as { status?: number }).status === "number"
        ? (e as { status: number }).status
        : 502;
    return Response.json({ error: message }, { status });
  }
}
