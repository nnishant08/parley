# Parallel Research App — Project Spec

> A web app that runs deep research concurrently across Claude, ChatGPT, Mistral, and Gemini, has them critique each other's outputs, and produces a synthesized final document.

**Status:** spec v1, ready to build
**Last updated:** May 2026
**Build approach:** all phases at once, no sign-in (BYOK in browser, ephemeral sessions)

---

## 1. Goal

Give the user a single research question and produce a high-quality synthesized report by:
1. Running deep research **in parallel** on four frontier models
2. Having each model **critique** the other three's outputs
3. **Synthesizing** everything into one final document (consensus, disagreements, sources, recommendation)
4. Letting the user **export** as Markdown, PDF, or DOCX, and **ask follow-ups** on the report

The thesis: any single model has blind spots. Four working in parallel + cross-critique surfaces both consensus (high-confidence) and disagreement (worth investigating) better than any one model alone.

---

## 2. Scope

### In scope
- Single research question input (with optional uploaded PDF/doc context)
- Concurrent research across all 4 providers
- Cross-critique stage: each model sees the other 3 and writes a critique
- Synthesis stage: configurable model (Claude default) writes final doc
- Live streaming UI: each model's progress + final synthesized doc
- Export: Markdown, PDF, DOCX
- Follow-up Q&A on the finished report (single-turn, against the synthesizer model with the report as context)
- BYOK: user pastes their 4 API keys; stored in browser localStorage only
- Cost estimate displayed before kicking off a run

### Out of scope (for now)
- Sign-in / accounts / persistent server-side history
- Multi-user collaboration
- Audio/video input or output
- Custom prompt templates per model
- Streaming response chat (we do single-shot synthesis, then optional follow-up Q&A)

---

## 3. End-to-end user flow

1. User lands on home page → sees a paste-keys panel (one field per provider) + research question textarea
2. User pastes 4 API keys → keys are validated client-side (format check) → stored in `localStorage` encrypted with a session passphrase
3. User types research question, optionally uploads a PDF for context
4. App shows estimated cost (~$5–$15 for a typical run, varies)
5. User clicks **Start Research**
6. UI shows 4 cards (one per model) with live progress: "Planning… searching… reading sources… synthesizing…"
7. As each model finishes Stage 1 (deep research), its raw answer renders inline in its card
8. Once all 4 are done, **Stage 2** kicks off automatically: 4 critique calls in parallel (each model reads the other 3 and writes a critique) — also streams into each card
9. Once all critiques are in, **Stage 3** runs: Claude (or user-chosen) synthesizes everything into the final report — streams as it generates
10. Final doc renders below with: original question → exec summary → per-model raw answers (collapsible) → comparison table → consensus → disagreements → sources → final recommendation
11. Buttons: **Export MD / Export PDF / Export DOCX / Ask follow-up**
12. Follow-up: single text box → posts question + report context to synthesizer model → streams answer below the doc

---

## 4. Architecture overview

```
┌────────────────────────────┐
│  Browser (Next.js client)  │
│  - localStorage: API keys   │
│  - SSE/polling for updates │
└──────────┬─────────────────┘
           │ HTTPS (keys passed in request body, not stored server-side)
           ▼
┌────────────────────────────┐
│   Next.js API routes        │
│   (proxy / orchestrator)    │
└──┬─────┬─────┬─────┬───────┘
   │     │     │     │
   ▼     ▼     ▼     ▼
Anthropic OpenAI Gemini Mistral
(stream) (poll) (poll) (stream)
```

**Two integration patterns:**

| Provider | Pattern | Why |
|----------|---------|-----|
| Anthropic Claude | Streaming SSE, single agentic call w/ web_search tool | No deep research endpoint; approximation completes in 30–90s |
| OpenAI | Background mode + polling | `o3-deep-research` runs 5–30 min, must use `background=True` + poll |
| Gemini | Background mode + polling | Interactions API supports `background=True` + poll via interaction_id |
| Mistral | Streaming SSE, agent w/ web_search tool | No deep research API; approximation completes in 30–90s |

Stages 2 and 3 are all fast LLM calls (no deep research) — every model does these in <60s.

**Hosting:** Vercel for everything. Long-running providers (OpenAI/Gemini) handle their own infra; we just submit + poll. Claude/Mistral approximations stream and complete inside Vercel function limits (max 300s on Pro, ~60s on Hobby — we configure `maxDuration` on the relevant routes).

---

## 5. The pipeline (detailed)

### Stage 1 — Parallel research

Triggered by `POST /api/research/start` with `{ question, contextDocs, keys }`.

**Per-provider implementation:**

#### Anthropic (Claude)
- **Model:** `claude-opus-4-7`
- **Tools:** `web_search_20260209` (max_uses: 10), extended thinking enabled
- **Pattern:** Streaming SSE
- **System prompt:** "You are a research analyst. Conduct thorough, multi-source research on the user's question. Cite every claim with the source URL. Produce a structured report with: Question summary, Key findings, Detailed analysis, Sources."
- **Returns:** structured markdown report + sources array

#### OpenAI (ChatGPT)
- **Model:** `o3-deep-research-2025-06-26` (or `o4-mini-deep-research-2025-06-26` as cheaper option, user-selectable)
- **Endpoint:** `POST /v1/responses` with `background: true`
- **Tools:** `web_search_preview` (default)
- **Pattern:** Submit → get `response_id` → poll `GET /v1/responses/{id}` every 10s
- **Returns:** structured report + inline citations

#### Gemini
- **Model:** `deep-research-preview-04-2026` (default; offer `deep-research-max-preview-04-2026` as upgrade)
- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `background: true`
- **Tools:** Default (Google Search, URL Context, Code Execution)
- **Pattern:** Submit → get `interaction_id` → poll `GET /v1beta/interactions/{id}` every 10s
- **Returns:** structured report (potentially with inline charts — strip or render)

#### Mistral
- **Model:** `mistral-medium-latest` (Mistral Medium 3.5)
- **Endpoint:** Beta Agents API — create an agent with `tools: [{ type: "web_search" }]`, then create a conversation
- **Pattern:** Streaming via the conversation API
- **System prompt:** Same research-analyst framing as Claude
- **Returns:** markdown report + sources

**Concurrency:** all 4 kicked off in `Promise.all` from the orchestrator. Each one reports back to the client via its own SSE stream (Claude/Mistral) or via polling (OpenAI/Gemini). The client merges all 4 streams into the UI.

### Stage 2 — Cross-critique

Once all 4 Stage-1 reports are in, client calls `POST /api/research/critique` with all 4 reports.

For each of the 4 models, run **one prompt** in parallel:

```
You are reviewing 3 research reports written by other AI models on the same question.
Question: {original question}
Your own previous report: {your stage 1 output}

Now read the 3 reports below and provide a critical review:

[Model A]: {stage 1 output A}
[Model B]: {stage 1 output B}
[Model C]: {stage 1 output C}

For each of the 3 reports, identify:
- Factual errors or unsupported claims
- Important points your own report missed
- Where you agree
- Where you disagree and why

Output as structured JSON:
{ "critiques": [{ "model": "...", "agreements": [...], "disagreements": [...], "errors": [...], "missed_points": [...] }] }
```

All 4 critique calls use the **base chat models** (no deep research) — they're cheap and fast (~30s each).

- Anthropic: `claude-opus-4-7`
- OpenAI: `gpt-5` (or whatever current flagship is — verify at build time)
- Gemini: `gemini-2.5-pro`
- Mistral: `mistral-medium-latest`

### Stage 3 — Synthesis

Client calls `POST /api/research/synthesize` with all 4 reports + 4 critiques.

Single call to the user-selected synthesizer (default: Claude `claude-opus-4-7`). System prompt:

```
You are synthesizing a research investigation. Four AI models researched the same question
and then critiqued each other. Your job: produce ONE definitive report.

Question: {question}

[For each model: its report + the 3 critiques others wrote of it]

Produce the final report with this structure:

# {Question}

## Executive Summary
2–3 paragraphs. The bottom line.

## Per-model raw answers
(Just enumerate; the UI will collapse these)

## Comparison Table
Markdown table: Claim | Claude | ChatGPT | Gemini | Mistral | Status (Consensus / Partial / Conflict)

## Consensus
Points all (or 3+) models agree on. High confidence.

## Disagreements & Critiques
Where models disagreed. Include who said what and which side is better supported by sources.

## Sources
Deduplicated, ordered list of all cited URLs across all 4 reports.

## Final Recommendation
The synthesizer's bottom-line answer to the question, factoring in critiques.
```

Streamed back via SSE.

### Follow-up Q&A

`POST /api/research/followup` with `{ question, finalReport, originalQuestion }` → streams answer from the synthesizer model with the report in context. Single-turn (no chat history).

---

## 6. Tech stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14 (App Router) + TypeScript | Best-in-class streaming, single repo, easy Vercel deploy |
| UI | Tailwind CSS + shadcn/ui | Fast to build, looks good out of box |
| State | Zustand | Light, no Redux ceremony — fits the 4-job orchestration well |
| API SDKs | `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@mistralai/mistralai` | Official SDKs |
| PDF parsing (uploads) | `unpdf` (or `pdf-parse`) | Server-side, no native deps |
| Markdown rendering | `react-markdown` + `remark-gfm` | Tables, task lists |
| Markdown export | Direct string write | No lib needed |
| PDF export | `@react-pdf/renderer` or `jsPDF` + `html2canvas` | Client-side |
| DOCX export | `docx` (npm) | Server-side route to generate |
| Streaming | Server-Sent Events (SSE) via Next.js Route Handlers | Simpler than WebSockets for one-way |
| Encryption (BYOK) | Web Crypto API (AES-GCM) | Browser-native, no deps |
| Hosting | Vercel | Free tier covers personal use |

**No database, no auth, no Inngest** for v1. Everything is request-scoped or browser-local.

---

## 7. Suggested file structure

```
/app
  /api
    /research
      start/route.ts       # POST: kick off all 4 stage-1 jobs, returns 4 tokens
      poll/route.ts        # GET: poll a single job by token (used for OpenAI/Gemini)
      stream/route.ts      # GET: SSE stream for a single job (used for Claude/Mistral)
      critique/route.ts    # POST: run all 4 critiques in parallel
      synthesize/route.ts  # POST: synthesis stream (SSE)
      followup/route.ts    # POST: follow-up Q&A stream (SSE)
    /export
      pdf/route.ts
      docx/route.ts
      md/route.ts
  /(home)
    page.tsx               # Landing: keys panel + question input
  /research/[runId]
    page.tsx               # Active run view: 4 cards + final doc
/components
  KeyPanel.tsx
  QuestionInput.tsx
  CostEstimate.tsx
  ModelCard.tsx            # One per provider: progress + raw report + critique
  ComparisonTable.tsx
  FinalReport.tsx
  ExportButtons.tsx
  FollowUpBox.tsx
/lib
  /providers
    anthropic.ts           # research(), critique(), synthesize()
    openai.ts
    gemini.ts
    mistral.ts
  /crypto
    keys.ts                # encrypt/decrypt API keys with passphrase
  /export
    pdf.ts
    docx.ts
    md.ts
  /prompts
    research-system.ts
    critique-template.ts
    synthesis-system.ts
  types.ts                 # see below
  store.ts                 # Zustand store
```

---

## 8. Key data types

```typescript
// lib/types.ts

export type Provider = "anthropic" | "openai" | "gemini" | "mistral";

export interface ProviderKeys {
  anthropic: string;
  openai: string;
  gemini: string;
  mistral: string;
}

export interface ResearchRequest {
  question: string;
  contextDocs?: { name: string; text: string }[];
  synthesizerProvider: Provider; // default "anthropic"
  openaiTier?: "o3" | "o4-mini";
  geminiTier?: "preview" | "max";
}

export interface JobToken {
  provider: Provider;
  pattern: "stream" | "poll";
  upstreamId?: string; // OpenAI response_id or Gemini interaction_id
  startedAt: number;
}

export interface StageOneResult {
  provider: Provider;
  markdown: string;
  sources: { url: string; title?: string }[];
  tokensUsed: number;
  costUSD: number;
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

export interface FinalReport {
  question: string;
  executiveSummary: string;
  rawAnswers: Record<Provider, string>;
  comparisonTable: { claim: string; positions: Record<Provider, string>; status: "consensus" | "partial" | "conflict" }[];
  consensus: string[];
  disagreements: string[];
  sources: { url: string; title?: string; citedBy: Provider[] }[];
  recommendation: string;
  totalCostUSD: number;
}
```

---

## 9. UI/UX notes

- **Layout:** 2x2 grid of model cards above, final report below (renders progressively bottom-up)
- **Card states:** `idle` → `planning` → `searching` (with rotating "Reading X" status text) → `writing` → `done` → `critiquing` → `critique_done`
- **Each card shows:** logo/name, current status, elapsed time, raw answer (collapsible once done), critique it received from each other model (3 mini-tabs)
- **Cost estimate:** show before kicking off — based on rough averages (e.g., $4 OpenAI o3-deep, $3 Gemini Max, $0.50 Claude w/ web search, $0.30 Mistral, plus ~$1 for critiques + synthesis = ~$8 typical, ~$15 worst case)
- **Failure handling:** if one provider fails, mark that card as failed with retry button. Stage 2/3 proceeds with remaining providers (>=2 required to proceed).
- **Don't auto-start follow-up:** user clicks the input first.

---

## 10. Cost & rate considerations

| Stage | Calls | Approx cost (typical) |
|-------|-------|-----------------------|
| Stage 1 deep research × 4 | 4 | $4 (OpenAI o3) + $2 (Gemini DR) + $0.50 (Claude w/ search) + $0.30 (Mistral) = **~$7** |
| Stage 2 critiques × 4 | 4 | $0.20 each = **~$0.80** |
| Stage 3 synthesis | 1 | **~$0.50** |
| **Total per run** | 9 | **~$8** typical, $15 worst case |

Show this estimate before starting. Show actual cost at the end. **Hard cap configurable per run** (default $20).

---

## 11. Risks & open questions

1. **Mistral has no Deep Research API.** The Agents API + web_search approximation is decent but won't match Gemini DR or OpenAI DR depth. Acceptable trade-off; document this in UI ("Mistral: approximated").
2. **Gemini Interactions API is in public preview.** Subject to breaking changes. Pin to specific model snapshots; check release notes monthly.
3. **OpenAI Deep Research access requires verification.** User's API key must be on a verified org. Surface this clearly if it 403s.
4. **Long polls + Vercel timeouts.** Polling routes are lightweight and finish in <5s each — fine. The actual wait is on the provider side; we just keep checking.
5. **API key handling.** Keys never persist on our server; they're sent in each request body and discarded after the upstream call. Document this clearly in a "Privacy" footer. Browser-side encryption with a session passphrase is defense-in-depth, not a silver bullet.
6. **Cross-critique can echo-chamber.** If all 4 models agree on something incorrect, the synthesis will too. This is a known limitation — mitigate by showing raw answers prominently, not hiding them.
7. **PDF context size.** Cap uploaded PDF text at ~50k tokens before sending to providers. If larger, summarize first or warn the user.

---

## 12. Build sequence for Claude Code

Suggested order — each step ships something testable:

1. **Scaffold** — Next.js + Tailwind + shadcn/ui + Zustand. Empty home page.
2. **Key panel** — paste/validate/encrypt 4 API keys, store in `localStorage`. Test: refresh, keys persist (encrypted).
3. **One provider end-to-end (start with Claude)** — `lib/providers/anthropic.ts` with `research()` using `web_search_20260209`. Wire up SSE streaming to one card. Test: end-to-end Claude research works.
4. **Add Mistral** — same streaming pattern.
5. **Add OpenAI** — submit/poll pattern. Build `/api/research/poll` endpoint. Test: 3 models work concurrently.
6. **Add Gemini** — same submit/poll pattern.
7. **Stage 2 critiques** — once all 4 Stage 1 cards are done, fire critique calls. Render critiques in each card.
8. **Stage 3 synthesis** — Claude synthesis with full structured output. Stream to final report component.
9. **Comparison table + collapsible raw answers** — polish the final report UI.
10. **Export buttons** — MD (trivial), DOCX (server route w/ `docx` lib), PDF (client w/ `@react-pdf/renderer`).
11. **PDF context upload** — file input → parse → include in research prompts.
12. **Follow-up Q&A box** — single SSE call to synthesizer model with full report in context.
13. **Cost estimate + actual cost display.**
14. **Synthesizer-model picker** in settings (Claude default; Gemini/OpenAI/Mistral selectable).
15. **Polish:** error states, retry buttons, loading skeletons, empty states.

---

## 13. Things to verify before/during build

- Confirm exact Anthropic web_search tool version string (`web_search_20260209` per docs as of May 2026)
- Confirm OpenAI `o3-deep-research-2025-06-26` is still the current snapshot
- Confirm Gemini `deep-research-preview-04-2026` model ID
- Confirm Mistral Agents API beta endpoints haven't moved out of beta with breaking changes
- Test BYOK key with each provider for a 1-token request before kicking off Stage 1 (key validation)

---

## 14. Future (post-v1)

- Optional sign-in (Supabase) + saved research history
- Compare multiple runs of the same question side-by-side
- Custom prompt templates per provider
- Custom report structures (user-defined sections)
- Webhook delivery (email when done)
- Multi-question batches
- Add Perplexity, xAI Grok, etc. as additional providers
