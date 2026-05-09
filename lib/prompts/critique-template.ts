import { PROVIDER_LABEL, type Provider } from "@/lib/types";

export const CRITIQUE_SYSTEM_PROMPT = `You are an expert research reviewer reading three research reports written by other AI models on the same question. You also have your own previous report on the same question for context.

Your job: review each of the OTHER three reports critically, and output your review as a JSON object exactly matching the schema below. Do not include prose outside the JSON. Do not wrap the JSON in markdown fences.

For each of the three reports you review:
- agreements: 1–4 specific points where you agree with the report's claims, citing why.
- disagreements: 1–4 points where you genuinely disagree (with reasoning), or empty array if you don't.
- errors: factual errors or unsupported claims you see — be specific. Empty array if none.
- missed_points: important points the report missed that your own report covered, or that should have been covered. Empty array if none.

Be substantive, not generic. Avoid filler ("the report is well-structured"); focus on the substance of claims.

Schema:
{
  "critiques": [
    {
      "model": "<one of the model names you were given>",
      "agreements": ["..."],
      "disagreements": ["..."],
      "errors": ["..."],
      "missed_points": ["..."]
    }
  ]
}`;

export function buildCritiqueUserMessage({
  question,
  ownProvider,
  ownReport,
  others,
}: {
  question: string;
  ownProvider: Provider;
  ownReport: string;
  others: Array<{ provider: Provider; markdown: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`Question: ${question}`);
  lines.push("");
  lines.push(
    `Your own previous report (${PROVIDER_LABEL[ownProvider]}, for context only — do not review yourself):`,
  );
  lines.push(ownReport || "(no report — your own run failed)");
  lines.push("");
  lines.push("Now review the 3 reports below.");
  lines.push("");
  for (const o of others) {
    lines.push(`### ${PROVIDER_LABEL[o.provider]}`);
    lines.push(o.markdown || "(no report — that run failed; output empty arrays for this model)");
    lines.push("");
  }
  lines.push(
    `Output the JSON now. The "model" field for each critique must be one of: ${others.map((o) => JSON.stringify(PROVIDER_LABEL[o.provider])).join(", ")}.`,
  );
  return lines.join("\n");
}

/**
 * Some models wrap JSON in code fences or include preamble. This is a
 * defensive parser that pulls the first {...} block out of arbitrary
 * text and JSON.parses it.
 */
export function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  // Strip code fences
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  // Find first { ... matching brace
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object found");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error("unbalanced JSON object");
}
