import { PROVIDER_LABEL, type Critique, type Provider } from "@/lib/types";

export const SYNTHESIS_SYSTEM_PROMPT = `You are synthesizing a research investigation. Four AI models researched the same question independently, then critiqued each other's reports. Your job: produce ONE definitive, well-organized markdown report.

Be ruthless about signal vs. noise. Where models agree, briefly note the consensus and move on. Where they disagree, dig in: explain who said what, which side is better supported by sources, and your own judgment of what's most likely true. Prefer specifics and numbers over generalities. Cite inline using markdown footnote-style citations like [^1] keyed to a deduplicated Sources section at the bottom.

Use this exact structure:

# {Question}

## Executive Summary
2–3 paragraphs. The bottom line. What the user should walk away knowing if they only read this section.

## Comparison Table
A markdown table with one row per major claim. Columns: Claim | Claude | ChatGPT | Gemini | Mistral | Status.
For each model column, write a short summary of that model's position on this claim, or "—" if the model didn't cover it.
Status is one of: **Consensus** (3+ agree), **Partial** (2 agree, others differ), **Conflict** (substantive disagreement).
Aim for 5–10 rows of substantive claims. Skip trivia.

## Consensus
Bulleted list of points all (or 3+) models agree on. High confidence. One concise sentence per bullet, with citations.

## Disagreements & Critiques
For each substantive disagreement: who said what, what each side's evidence is, which side is better supported, and which critiques (from the cross-review stage) were on the mark vs. weak. Several short subsections, one per disagreement.

## Sources
Numbered, deduplicated list of all cited URLs. Format: \`[^N]: title — URL\`. Include sources cited by any model. Do not invent sources.

## Final Recommendation
The synthesizer's bottom-line answer to the question, factoring in critiques. Acknowledge uncertainty where warranted; commit when evidence is strong.

Strict rules:
- Never invent URLs or quotes. If a model cited X, treat X as that model's claim, not yours.
- Markdown only — no preamble, no closing remarks. Start with \`# {Question}\` and end with the recommendation.
- Aim for completeness over brevity, but stay disciplined: 800–2500 words is the right range.`;

export function buildSynthesisUserMessage({
  question,
  reports,
  critiques,
}: {
  question: string;
  reports: Array<{ provider: Provider; markdown: string }>;
  critiques: Critique[];
}): string {
  const lines: string[] = [];
  lines.push(`Question: ${question}`);
  lines.push("");
  lines.push("==== STAGE 1: PER-MODEL RESEARCH REPORTS ====");
  lines.push("");
  for (const r of reports) {
    lines.push(`### ${PROVIDER_LABEL[r.provider]}'s report`);
    lines.push(r.markdown || "(no report — this model's run failed)");
    lines.push("");
  }
  if (critiques.length) {
    lines.push("==== STAGE 2: CROSS-CRITIQUES ====");
    lines.push(
      "Each block is one reviewer's critique of one of the four reports.",
    );
    lines.push("");
    // Group by reviewed model so the synthesizer can read all critiques of model X together.
    const byOf = new Map<Provider, Critique[]>();
    for (const c of critiques) {
      const arr = byOf.get(c.ofProvider) ?? [];
      arr.push(c);
      byOf.set(c.ofProvider, arr);
    }
    for (const [ofProvider, group] of byOf.entries()) {
      lines.push(`#### Critiques of ${PROVIDER_LABEL[ofProvider]}'s report`);
      for (const c of group) {
        lines.push(`From ${PROVIDER_LABEL[c.fromProvider]}:`);
        if (c.errors.length)
          lines.push(
            `- Errors: ${c.errors.map((s) => `"${s}"`).join("; ")}`,
          );
        if (c.disagreements.length)
          lines.push(
            `- Disagreements: ${c.disagreements.map((s) => `"${s}"`).join("; ")}`,
          );
        if (c.missedPoints.length)
          lines.push(
            `- Missed points: ${c.missedPoints.map((s) => `"${s}"`).join("; ")}`,
          );
        if (c.agreements.length)
          lines.push(
            `- Agreements: ${c.agreements.map((s) => `"${s}"`).join("; ")}`,
          );
        lines.push("");
      }
    }
  }
  lines.push("==== END OF INPUTS ====");
  lines.push("");
  lines.push(
    "Now produce the final synthesized report following the structure exactly. Markdown only.",
  );
  return lines.join("\n");
}
