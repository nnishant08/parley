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
  status?: string;
  content?: OutputContent[];
  // web_search_call shape: { type: "web_search_call", action: { query, type } }
  action?: { type?: string; query?: string };
  // reasoning shape: { type: "reasoning", summary?: [{ type, text }] }
  summary?: Array<{ type?: string; text?: string }>;
}

interface Progress {
  text: string;
  sources: { url: string; title?: string }[];
  searchQueries: string[];
  searchCount: number;
}

/**
 * Walk the response output and extract everything we can show now.
 * Called every poll, not just on completion, so the UI sees live
 * progress instead of an empty card for 30 minutes.
 *
 *   - web_search_call → query, count
 *   - last "message" item → text + url-citation annotations (sources)
 *   - reasoning items contribute to "feels alive" via search count
 */
function extractProgress(output: OutputItem[] | undefined): Progress {
  const sources: { url: string; title?: string }[] = [];
  const seen = new Set<string>();
  const queries: string[] = [];
  const seenQueries = new Set<string>();
  let text = "";
  let searchCount = 0;

  if (!output?.length) return { text, sources, searchQueries: queries, searchCount };

  // Collect search calls + queries
  for (const item of output) {
    if (item.type === "web_search_call") {
      searchCount++;
      const q = item.action?.query;
      if (typeof q === "string" && q.length > 0 && !seenQueries.has(q)) {
        seenQueries.add(q);
        queries.push(q);
      }
    }
  }

  // Final assistant message (last "message" item) — text + citations
  for (let i = output.length - 1; i >= 0; i--) {
    const item = output[i];
    if (item.type !== "message") continue;
    const c = item.content?.[0];
    if (!c || typeof c.text !== "string") continue;
    text = c.text;
    for (const a of c.annotations ?? []) {
      if (typeof a.url === "string" && !seen.has(a.url)) {
        seen.add(a.url);
        sources.push({
          url: a.url,
          title: typeof a.title === "string" ? a.title : undefined,
        });
      }
    }
    break;
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
  const { responseId, apiKey } = body;
  if (!responseId || !apiKey) {
    return Response.json(
      { error: "Missing responseId or apiKey" },
      { status: 400 },
    );
  }

  // Polls are tiny but can also be 429'd; same retry budget as start.
  const client = new OpenAI({ apiKey, maxRetries: 6 });
  try {
    const resp = await client.responses.retrieve(responseId);
    const status = resp.status as string | undefined;
    const { text, sources, searchQueries, searchCount } = extractProgress(
      resp.output as OutputItem[] | undefined,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[proxy/openai/poll] ${responseId.slice(-12)} status=${status} searches=${searchCount} chars=${text.length}`,
    );

    if (status === "completed") {
      // eslint-disable-next-line no-console
      console.log(
        `[proxy/openai/poll] COMPLETED ${responseId} — ${text.length} chars, ${sources.length} sources, ${searchCount} searches`,
      );
      return Response.json({
        status,
        webSearches: searchCount,
        text,
        sources,
        searchQueries,
        usage: resp.usage ?? null,
      });
    }

    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "incomplete"
    ) {
      const errMsg =
        (resp as unknown as { error?: { message?: string } }).error?.message ??
        `Response ended with status ${status}`;
      return Response.json({
        status,
        error: errMsg,
        webSearches: searchCount,
        text,
        sources,
        searchQueries,
      });
    }

    // queued / in_progress — return live progress
    return Response.json({
      status,
      webSearches: searchCount,
      text,
      sources,
      searchQueries,
    });
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
