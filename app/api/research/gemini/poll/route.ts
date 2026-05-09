import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  interactionId: string;
  apiKey: string;
}

interface ContentPart {
  text?: string;
}

interface InteractionContent {
  parts?: ContentPart[];
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };
}

interface UrlContextResult {
  status?: string;
  url?: string;
}

// SDK Step union is large; we only inspect a few variants.
interface StepBase {
  type?: string;
  content?: InteractionContent[];
  result?: UrlContextResult[];
  arguments?: string;
  name?: string;
}

interface Progress {
  text: string;
  sources: { url: string; title?: string }[];
  searchQueries: string[];
  searchCount: number;
}

/**
 * Walk all steps and extract progress so far. Called on every poll —
 * not just on "completed" — so the UI sees searches, sources, and
 * partial text accumulate live instead of staring at an empty card
 * for 10+ minutes.
 */
function extractProgress(steps: StepBase[] | undefined): Progress {
  const sources: { url: string; title?: string }[] = [];
  const seen = new Set<string>();
  const queries: string[] = [];
  const seenQueries = new Set<string>();
  let text = "";
  let searchCount = 0;

  if (!steps?.length)
    return { text, sources, searchQueries: queries, searchCount };

  for (const step of steps) {
    switch (step.type) {
      case "model_output": {
        // Accumulate text from any model_output we see (there might be
        // multiple in a deep research run; concatenate in order).
        for (const c of step.content ?? []) {
          for (const p of c.parts ?? []) {
            if (typeof p.text === "string") text += p.text;
          }
          for (const g of c.groundingMetadata?.groundingChunks ?? []) {
            const w = g.web;
            if (w?.uri && !seen.has(w.uri)) {
              seen.add(w.uri);
              sources.push({ url: w.uri, title: w.title });
            }
          }
        }
        break;
      }
      case "google_search_call": {
        searchCount++;
        if (typeof step.arguments === "string" && step.arguments) {
          try {
            const a = JSON.parse(step.arguments) as { query?: string };
            if (typeof a.query === "string" && !seenQueries.has(a.query)) {
              seenQueries.add(a.query);
              queries.push(a.query);
            }
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case "url_context_call": {
        searchCount++;
        if (typeof step.arguments === "string" && step.arguments) {
          try {
            const a = JSON.parse(step.arguments) as { urls?: string[] };
            if (Array.isArray(a.urls)) {
              for (const u of a.urls) {
                if (typeof u === "string" && !seen.has(u)) {
                  seen.add(u);
                  sources.push({ url: u });
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case "url_context_result": {
        for (const r of step.result ?? []) {
          if (
            r.url &&
            (r.status === "success" || r.status === undefined) &&
            !seen.has(r.url)
          ) {
            seen.add(r.url);
            sources.push({ url: r.url });
          }
        }
        break;
      }
    }
  }

  return { text, sources, searchQueries: queries, searchCount };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { interactionId, apiKey } = body;
  if (!interactionId || !apiKey) {
    return Response.json(
      { error: "Missing interactionId or apiKey" },
      { status: 400 },
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  try {
    const interaction = await ai.interactions.get(interactionId);
    const status = interaction.status;
    const steps = (interaction as unknown as { steps?: StepBase[] }).steps;
    const { text, sources, searchQueries, searchCount } = extractProgress(steps);

    if (status === "completed") {
      // eslint-disable-next-line no-console
      console.log(
        `[proxy/gemini/poll] COMPLETED ${interactionId} — ${text.length} chars, ${sources.length} sources, ${searchCount} searches`,
      );
      return Response.json({
        status,
        webSearches: searchCount,
        text,
        sources,
        searchQueries,
      });
    }
    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "incomplete"
    ) {
      return Response.json({
        status,
        webSearches: searchCount,
        error: `Interaction ended with status ${status}`,
        text,
        sources,
        searchQueries,
      });
    }
    // in_progress / requires_action — return live progress
    return Response.json({
      status,
      webSearches: searchCount,
      text,
      sources,
      searchQueries,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/gemini/poll] retrieve failed:", e);
    const message = e instanceof Error ? e.message : "Poll failed";
    const status =
      typeof (e as { status?: number }).status === "number"
        ? (e as { status: number }).status
        : 502;
    return Response.json({ error: message }, { status });
  }
}
