import { NextRequest } from "next/server";
import OpenAI from "openai";
import { Mistral } from "@mistralai/mistralai";
import { GoogleGenAI } from "@google/genai";
import {
  CRITIQUE_SYSTEM_PROMPT,
  buildCritiqueUserMessage,
  extractJson,
} from "@/lib/prompts/critique-template";
import { PROVIDER_LABEL, type Provider } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Stage-2 base chat models per spec section 5 + Phase 0 verification.
const CHAT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-5.5",
  gemini: "gemini-2.5-pro",
  mistral: "mistral-medium-latest",
};

interface Body {
  fromProvider: Provider;
  question: string;
  ownReport: string;
  others: Array<{ provider: Provider; markdown: string }>;
  apiKey: string;
}

interface RawCritique {
  model?: string;
  agreements?: string[];
  disagreements?: string[];
  errors?: string[];
  missed_points?: string[];
}

function normalizeCritiques(
  raw: unknown,
  fromProvider: Provider,
  others: Body["others"],
): Array<{
  fromProvider: Provider;
  ofProvider: Provider;
  agreements: string[];
  disagreements: string[];
  errors: string[];
  missedPoints: string[];
}> {
  const list: RawCritique[] = Array.isArray(
    (raw as { critiques?: unknown }).critiques,
  )
    ? ((raw as { critiques: RawCritique[] }).critiques)
    : [];

  // Map model labels in the response back to providers.
  const labelToProvider: Record<string, Provider> = {};
  for (const o of others) {
    labelToProvider[PROVIDER_LABEL[o.provider].toLowerCase()] = o.provider;
    labelToProvider[o.provider] = o.provider;
  }

  const out: Array<{
    fromProvider: Provider;
    ofProvider: Provider;
    agreements: string[];
    disagreements: string[];
    errors: string[];
    missedPoints: string[];
  }> = [];

  for (const c of list) {
    const label = (c.model ?? "").trim().toLowerCase();
    const ofProvider = labelToProvider[label];
    if (!ofProvider) continue;
    out.push({
      fromProvider,
      ofProvider,
      agreements: Array.isArray(c.agreements) ? c.agreements.map(String) : [],
      disagreements: Array.isArray(c.disagreements)
        ? c.disagreements.map(String)
        : [],
      errors: Array.isArray(c.errors) ? c.errors.map(String) : [],
      missedPoints: Array.isArray(c.missed_points)
        ? c.missed_points.map(String)
        : [],
    });
  }
  return out;
}

async function critiqueWithAnthropic(body: Body): Promise<string> {
  const userMsg = buildCritiqueUserMessage({
    question: body.question,
    ownProvider: body.fromProvider,
    ownReport: body.ownReport,
    others: body.others,
  });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": body.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CHAT_MODEL.anthropic,
      max_tokens: 4096,
      system: CRITIQUE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${err.slice(0, 300)}`);
  }
  const json = (await resp.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textBlock = json.content?.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

async function critiqueWithOpenAI(body: Body): Promise<string> {
  const client = new OpenAI({ apiKey: body.apiKey, maxRetries: 6 });
  const userMsg = buildCritiqueUserMessage({
    question: body.question,
    ownProvider: body.fromProvider,
    ownReport: body.ownReport,
    others: body.others,
  });
  const resp = await client.chat.completions.create({
    model: CHAT_MODEL.openai,
    messages: [
      { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    response_format: { type: "json_object" },
  });
  return resp.choices[0]?.message?.content ?? "";
}

async function critiqueWithGemini(body: Body): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: body.apiKey });
  const userMsg = buildCritiqueUserMessage({
    question: body.question,
    ownProvider: body.fromProvider,
    ownReport: body.ownReport,
    others: body.others,
  });
  const resp = await ai.models.generateContent({
    model: CHAT_MODEL.gemini,
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    config: {
      systemInstruction: CRITIQUE_SYSTEM_PROMPT,
      responseMimeType: "application/json",
    },
  });
  return resp.text ?? "";
}

async function critiqueWithMistral(body: Body): Promise<string> {
  const client = new Mistral({ apiKey: body.apiKey });
  const userMsg = buildCritiqueUserMessage({
    question: body.question,
    ownProvider: body.fromProvider,
    ownReport: body.ownReport,
    others: body.others,
  });
  const resp = await client.chat.complete({
    model: CHAT_MODEL.mistral,
    messages: [
      { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    responseFormat: { type: "json_object" },
  });
  const choice = resp.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) {
    return choice
      .map((c) => (typeof c === "object" && "text" in c ? c.text : ""))
      .join("");
  }
  return "";
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { fromProvider, question, ownReport, others, apiKey } = body;
  if (!fromProvider || !question || !apiKey || !Array.isArray(others)) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  // eslint-disable-next-line no-console
  console.log(`[proxy/critique] ${fromProvider} starting`);

  let raw = "";
  try {
    switch (fromProvider) {
      case "anthropic":
        raw = await critiqueWithAnthropic(body);
        break;
      case "openai":
        raw = await critiqueWithOpenAI(body);
        break;
      case "gemini":
        raw = await critiqueWithGemini(body);
        break;
      case "mistral":
        raw = await critiqueWithMistral(body);
        break;
      default:
        return Response.json({ error: "Unknown provider" }, { status: 400 });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[proxy/critique] ${fromProvider} failed:`, e);
    const message = e instanceof Error ? e.message : "Critique call failed";
    return Response.json({ error: message }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      `[proxy/critique] ${fromProvider} JSON parse failed; raw:`,
      raw.slice(0, 400),
    );
    return Response.json(
      {
        error: `Could not parse JSON from ${fromProvider}: ${e instanceof Error ? e.message : "unknown"}`,
        raw: raw.slice(0, 400),
      },
      { status: 502 },
    );
  }

  const critiques = normalizeCritiques(parsed, fromProvider, others);
  // eslint-disable-next-line no-console
  console.log(
    `[proxy/critique] ${fromProvider} done — ${critiques.length} critique${critiques.length === 1 ? "" : "s"} in ${Date.now() - t0}ms`,
  );
  return Response.json({ critiques });
}
