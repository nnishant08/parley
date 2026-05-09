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

// The SDK's Step union is large; we only care about a few variants.
interface StepBase {
  type?: string;
  content?: InteractionContent[];
  result?: UrlContextResult[];
}

/**
 * Walk the interaction's steps to extract the final markdown + sources.
 *
 *  - Last "model_output" step → its content[0].parts[*].text concatenated
 *  - URL context result steps → URLs of successfully fetched sources
 *  - Grounding metadata on model_output → web search citation URLs
 */
function extractFinal(steps: StepBase[] | undefined): {
  text: string;
  sources: { url: string; title?: string }[];
  searchCount: number;
} {
  const sources: { url: string; title?: string }[] = [];
  const seen = new Set<string>();
  let text = "";
  let searchCount = 0;

  if (!steps?.length) return { text, sources, searchCount };

  // Find the last model_output and accumulate its text.
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === "model_output" && Array.isArray(step.content)) {
      const buf: string[] = [];
      for (const c of step.content) {
        for (const p of c.parts ?? []) {
          if (typeof p.text === "string") buf.push(p.text);
        }
        // grounding citations
        for (const g of c.groundingMetadata?.groundingChunks ?? []) {
          const w = g.web;
          if (w?.uri && !seen.has(w.uri)) {
            seen.add(w.uri);
            sources.push({ url: w.uri, title: w.title });
          }
        }
      }
      if (buf.length) {
        text = buf.join("");
        break;
      }
    }
  }

  // URLs touched via the URL-context tool
  for (const step of steps) {
    if (step.type === "url_context_result" && Array.isArray(step.result)) {
      for (const r of step.result) {
        if (
          r.url &&
          (r.status === "success" || r.status === undefined) &&
          !seen.has(r.url)
        ) {
          seen.add(r.url);
          sources.push({ url: r.url });
        }
      }
    }
    if (
      step.type === "google_search_call" ||
      step.type === "url_context_call"
    ) {
      searchCount++;
    }
  }

  return { text, sources, searchCount };
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
    const { text, sources, searchCount } = extractFinal(steps);

    if (status === "completed") {
      return Response.json({
        status,
        webSearches: searchCount,
        text,
        sources,
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
      });
    }
    // in_progress / requires_action
    return Response.json({ status, webSearches: searchCount });
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
