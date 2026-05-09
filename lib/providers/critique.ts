import type { Critique, Provider, ProviderKeys } from "@/lib/types";

interface CritiqueResp {
  critiques?: Critique[];
  error?: string;
}

/**
 * Run one provider's critique pass and return its (up-to-3) critiques.
 * Errors return an empty array — a failed critique shouldn't kill the
 * run; the synthesizer can work with whatever critiques came back.
 */
export async function runCritique({
  fromProvider,
  question,
  ownReport,
  others,
  apiKey,
}: {
  fromProvider: Provider;
  question: string;
  ownReport: string;
  others: Array<{ provider: Provider; markdown: string }>;
  apiKey: string;
}): Promise<{ critiques: Critique[]; error?: string }> {
  try {
    const r = await fetch("/api/research/critique", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromProvider,
        question,
        ownReport,
        others,
        apiKey,
      }),
    });
    const json = (await r.json()) as CritiqueResp;
    if (!r.ok || json.error) {
      return { critiques: [], error: json.error || `HTTP ${r.status}` };
    }
    return { critiques: json.critiques ?? [] };
  } catch (e) {
    return {
      critiques: [],
      error: e instanceof Error ? e.message : "Critique fetch failed",
    };
  }
}

/**
 * Decide which providers are eligible to run critiques. A provider
 * needs:
 *   - status === "done" (we have a real report from them)
 *   - their apiKey present
 * If fewer than 2 providers are eligible, the critique stage is
 * skipped entirely (matches spec: ">=2 required to proceed").
 */
export function eligibleProviders(
  providerStatuses: Partial<Record<Provider, "done" | "failed" | string>>,
  keys: ProviderKeys | null,
): Provider[] {
  if (!keys) return [];
  const out: Provider[] = [];
  for (const [p, status] of Object.entries(providerStatuses) as Array<
    [Provider, string]
  >) {
    if (status === "done" && keys[p]) out.push(p);
  }
  return out;
}
