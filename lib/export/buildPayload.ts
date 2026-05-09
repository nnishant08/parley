import type { ResearchRun } from "@/lib/store";
import { PROVIDER_LABEL, PROVIDERS, type Provider } from "@/lib/types";

export interface ExportPayload {
  question: string;
  markdown: string; // full assembled doc (synthesis + appendices)
  filenameStem: string;
}

/**
 * Build the full markdown export of a finished run. Order:
 *   1. Question (h1)
 *   2. Synthesized report (verbatim, the synthesizer's full output)
 *   3. --- divider
 *   4. Per-model raw answers (h2 each)
 *   5. Combined sources (deduped, with citedBy markers)
 */
export function buildExportPayload(run: ResearchRun): ExportPayload {
  const lines: string[] = [];

  // 1. Question
  lines.push(`# ${run.question}`);
  lines.push("");

  // 2. Synthesis (already starts with `# Question` per the synth prompt;
  //    we keep that — it's redundant but harmless and may include the
  //    synthesizer's interpretation of the question wording).
  const synth = run.synthesis.markdown.trim();
  if (synth) {
    lines.push(synth);
    lines.push("");
  } else {
    lines.push("_Synthesis not yet complete._");
    lines.push("");
  }

  // 3. Divider
  lines.push("---");
  lines.push("");

  // 4. Per-model raw answers
  lines.push("## Per-model raw answers");
  lines.push("");
  for (const p of PROVIDERS) {
    const r = run.providers[p];
    if (!r?.markdown) continue;
    lines.push(`### ${PROVIDER_LABEL[p]}`);
    lines.push("");
    lines.push(r.markdown.trim());
    lines.push("");
  }

  // 5. Combined sources
  const sourceMap = new Map<
    string,
    { title?: string; citedBy: Set<Provider> }
  >();
  for (const p of PROVIDERS) {
    const r = run.providers[p];
    if (!r) continue;
    for (const s of r.sources) {
      const existing = sourceMap.get(s.url);
      if (existing) {
        existing.citedBy.add(p);
        if (!existing.title && s.title) existing.title = s.title;
      } else {
        sourceMap.set(s.url, { title: s.title, citedBy: new Set([p]) });
      }
    }
  }
  if (sourceMap.size > 0) {
    lines.push("## Combined sources");
    lines.push("");
    const sorted = Array.from(sourceMap.entries()).sort(
      ([, a], [, b]) => b.citedBy.size - a.citedBy.size,
    );
    for (const [url, info] of sorted) {
      const cited = PROVIDERS.filter((p) => info.citedBy.has(p))
        .map((p) => PROVIDER_LABEL[p])
        .join(", ");
      lines.push(`- [${info.title || url}](${url}) — _cited by ${cited}_`);
    }
    lines.push("");
  }

  // Filename: first 50 chars of the question, slugified
  const stem = run.question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "research";

  return {
    question: run.question,
    markdown: lines.join("\n"),
    filenameStem: stem,
  };
}
