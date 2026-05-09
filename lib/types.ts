export type Provider = "anthropic" | "openai" | "gemini" | "mistral";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "mistral"];

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  mistral: "Mistral",
};

export interface ProviderKeys {
  anthropic: string;
  openai: string;
  gemini: string;
  mistral: string;
}

export interface ResearchRequest {
  question: string;
  contextDocs?: { name: string; text: string }[];
  synthesizerProvider: Provider;
  openaiTier?: "o3" | "o4-mini";
  geminiTier?: "preview" | "max";
}

export interface JobToken {
  provider: Provider;
  pattern: "stream" | "poll";
  upstreamId?: string;
  startedAt: number;
}

export interface Source {
  url: string;
  title?: string;
}

export interface StageOneResult {
  provider: Provider;
  markdown: string;
  sources: Source[];
  tokensUsed?: number;
  costUSD?: number;
  durationMs: number;
}

export interface Critique {
  fromProvider: Provider;
  ofProvider: Provider;
  agreements: string[];
  disagreements: string[];
  errors: string[];
  missedPoints: string[];
}

export interface ComparisonRow {
  claim: string;
  positions: Partial<Record<Provider, string>>;
  status: "consensus" | "partial" | "conflict";
}

export interface FinalReport {
  question: string;
  executiveSummary: string;
  rawAnswers: Partial<Record<Provider, string>>;
  comparisonTable: ComparisonRow[];
  consensus: string[];
  disagreements: string[];
  sources: { url: string; title?: string; citedBy: Provider[] }[];
  recommendation: string;
  totalCostUSD?: number;
}
