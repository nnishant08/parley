import { NextRequest } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  responseId: string;
  apiKey: string;
}

interface Annotation {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface OutputContent {
  type?: string;
  text?: string;
  annotations?: Annotation[];
}

interface OutputItem {
  type?: string;
  content?: OutputContent[];
}

/**
 * Extract the assistant's final markdown + cited sources from a
 * completed Responses API result. Deep research returns a list of
 * output items; we want the last "message" item's text content and
 * its url_citation annotations.
 */
function extractFinal(output: OutputItem[] | undefined): {
  text: string;
  sources: { url: string; title?: string }[];
} {
  if (!output?.length) return { text: "", sources: [] };
  // Walk from the end; the final assistant message is what we want.
  for (let i = output.length - 1; i >= 0; i--) {
    const item = output[i];
    if (item.type !== "message") continue;
    const content = item.content?.[0];
    if (!content || typeof content.text !== "string") continue;
    const text = content.text;
    const seen = new Set<string>();
    const sources: { url: string; title?: string }[] = [];
    for (const a of content.annotations ?? []) {
      if (typeof a.url === "string" && !seen.has(a.url)) {
        seen.add(a.url);
        sources.push({
          url: a.url,
          title: typeof a.title === "string" ? a.title : undefined,
        });
      }
    }
    return { text, sources };
  }
  return { text: "", sources: [] };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { responseId, apiKey } = body;
  if (!responseId || !apiKey) {
    return Response.json(
      { error: "Missing responseId or apiKey" },
      { status: 400 },
    );
  }

  const client = new OpenAI({ apiKey });
  try {
    const resp = await client.responses.retrieve(responseId);
    const status = resp.status as string | undefined;

    // Lightweight progress signal: count web_search_call entries the
    // model has emitted so far. Lets the UI show "N searches so far".
    let webSearches = 0;
    for (const item of (resp.output as OutputItem[] | undefined) ?? []) {
      if (item.type === "web_search_call") webSearches++;
    }

    if (status === "completed") {
      const { text, sources } = extractFinal(
        resp.output as OutputItem[] | undefined,
      );
      return Response.json({
        status,
        webSearches,
        text,
        sources,
        usage: resp.usage ?? null,
      });
    }

    if (status === "failed" || status === "cancelled" || status === "incomplete") {
      const errMsg =
        // OpenAI's response shape exposes `error` on terminal states.
        (resp as unknown as { error?: { message?: string } }).error?.message ??
        `Response ended with status ${status}`;
      return Response.json({ status, error: errMsg, webSearches });
    }

    // queued / in_progress
    return Response.json({ status, webSearches });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[proxy/openai/poll] retrieve failed:", e);
    const message = e instanceof Error ? e.message : "Poll failed";
    const status =
      typeof (e as { status?: number }).status === "number"
        ? (e as { status: number }).status
        : 502;
    return Response.json({ error: message }, { status });
  }
}
