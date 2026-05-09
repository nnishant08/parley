# Parley

Run deep research concurrently across **Claude**, **ChatGPT**, **Mistral**, and **Gemini**, have them critique each other's outputs, and produce one synthesized final document.

> The thesis: any single model has blind spots. Four working in parallel + cross-critique surfaces both **consensus** (high-confidence) and **disagreement** (worth investigating) better than any one model alone.

A Next.js 14 app. **BYOK** — API keys live only in your browser, encrypted at rest with AES-GCM. Nothing is persisted server-side.

---

## What it does

```
┌─ You type a question ─────────────────────────────────────┐
│                                                            │
│  Stage 1 (parallel) — each provider does deep research:   │
│    • Claude    web_search_20260209 + extended thinking     │
│    • Mistral   beta Agents API + web_search                │
│    • OpenAI    o4-mini-deep-research (background + poll)   │
│    • Gemini    deep-research-preview (Interactions API)    │
│                                                            │
│  Stage 2 (parallel) — each model reads the other 3 and    │
│    writes a structured critique (errors, agreements,       │
│    disagreements, missed points). gpt-5.5 / opus 4.7 /     │
│    gemini-2.5-pro / mistral-medium-latest.                 │
│                                                            │
│  Stage 3 — your chosen synthesizer (default Claude) reads │
│    all 4 reports + 12 critiques and produces ONE report   │
│    with: exec summary, comparison table, consensus,        │
│    disagreements, sources, recommendation.                 │
│                                                            │
└─ Export as Markdown / DOCX / PDF, ask follow-ups ─────────┘
```

## Features

- **2×2 grid** of model cards — each streams its progress live (Planning → Searching → Writing → Done)
- **Live search-query feed** as each model issues queries
- **Source list** per card + a deduped "combined sources" view across all 4 models, with citedBy markers
- **Cross-critique stage** — each card shows the 3 critiques it received, color-coded by category
- **Synthesized final report** below the grid, streaming in as it's written
- **PDF context upload** — attach a PDF and it's extracted via [`unpdf`](https://github.com/unjs/unpdf) and sent to all 4 providers as context
- **Export** — Markdown (client-side), DOCX (server via [`docx`](https://www.npmjs.com/package/docx)), PDF (server via [`@react-pdf/renderer`](https://react-pdf.org/))
- **Follow-up Q&A** — single-turn questions against the finished report, streaming answer
- **Synthesizer picker** — any of the 4 providers can run synthesis & follow-up
- **Cost estimate** before you start, breakdown after
- **Retry buttons** on failed cards
- **No sign-in. No DB. No history.** Pure ephemeral browser session.

---

## Run locally

Requires Node 20+ and pnpm.

```bash
git clone https://github.com/nnishant08/parley.git
cd parley
pnpm install
pnpm dev
```

Open <http://localhost:3000>. Paste your 4 API keys, pick a passphrase, and run a question.

### API keys you'll need

| Provider | Where to get it | Notes |
|---|---|---|
| Anthropic | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | Web search must be enabled in your console |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Org must be **verified** — Deep Research requires it |
| Google AI | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Standard Gemini API key |
| Mistral | [console.mistral.ai/api-keys/](https://console.mistral.ai/api-keys/) | Beta Agents API needed (it's on by default) |

Keys are encrypted with PBKDF2(SHA-256, 100k iterations) → AES-GCM-256, stored as a single base64 blob in `localStorage`. They're sent in the request body to our Next.js routes, which forward them to each provider as the bearer token and discard them after the upstream call. **Never logged, never persisted server-side.** Read [`lib/crypto/keys.ts`](lib/crypto/keys.ts) — it's ~80 lines.

---

## Cost

A typical full-pipeline run costs about **$5.60**:

| Stage | Cost |
|---|---|
| Claude stage 1 (web search) | $0.50 |
| Mistral stage 1 (web search) | $0.30 |
| OpenAI o4-mini-deep-research | $1.50 |
| Gemini deep-research-preview | $2.00 |
| 4× critiques | $0.80 |
| 1× synthesis | $0.50 |
| **Total** | **$5.60** |

The pre-run UI shows this estimate. The hard cap is $20 by default.

To swap OpenAI to the heavier `o3-deep-research` (~$4 instead of $1.50), pass `tier: "o3"` in the start payload — there's no UI for it yet but the code path exists.

---

## Architecture

```
┌────────────────────────────────────┐
│  Browser (Next.js 14 App Router)   │
│  - localStorage: encrypted keys    │
│  - Zustand: run state              │
│  - SSE parser shared across calls  │
└──────────────┬─────────────────────┘
               │ HTTPS — keys in body, not stored server-side
               ▼
┌────────────────────────────────────┐
│  Next.js Route Handlers (proxy)    │
│  - /api/research/<provider>/...    │
│  - /api/research/critique          │
│  - /api/research/synthesize        │
│  - /api/research/followup          │
│  - /api/upload/pdf  (unpdf)        │
│  - /api/export/{docx,pdf}          │
└──┬──────┬──────┬──────┬────────────┘
   ▼      ▼      ▼      ▼
Anthropic  Mistral   OpenAI   Gemini
 (SSE)    (SSE)   (poll)   (poll)
```

Two integration patterns:

| Provider | Stage 1 pattern | Why |
|---|---|---|
| Claude | Streaming SSE | No deep-research endpoint; web_search tool gives a 30–90s approximation |
| Mistral | Streaming SSE | Same reason; Beta Agents API + web_search |
| OpenAI | Submit + poll | `o4-mini-deep-research` runs 5–15 min, must use `background:true` |
| Gemini | Submit + poll | Interactions API also long-running |

Stages 2 (critiques) and 3 (synthesis) are short streaming chat completions, all via the same `/api/research/synthesize` and `/api/research/critique` routes. Server-side translation makes the wire format Anthropic-shaped regardless of which provider runs the call, so the client SSE parser stays simple.

---

## File structure

```
app/
  api/
    research/
      claude/route.ts          # SSE proxy → Anthropic /v1/messages
      mistral/route.ts         # SSE proxy → Mistral conversations.startStream
      openai/start|poll        # background submit + retrieve
      gemini/start|poll        # background interactions.create + get
      critique/route.ts        # provider-dispatching critique (4 SDKs)
      synthesize/route.ts      # any synthesizer, unified SSE out
      followup/route.ts        # same shape, one-shot Q&A
    upload/pdf/route.ts        # unpdf text extraction
    export/{docx,pdf}/route.ts # generators
  research/[runId]/page.tsx    # the run view
  page.tsx                     # home
components/
  KeyPanel.tsx                 # paste / unlock / copy / forget
  QuestionInput.tsx            # textarea + suggestions + PDF upload + synthesizer picker
  ModelCard.tsx                # one-per-provider streaming card
  FinalReport.tsx              # synthesis + raw answers + combined sources
  ExportButtons.tsx            # MD / DOCX / PDF
  FollowUpBox.tsx              # post-synthesis Q&A
  CostEstimate.tsx             # pre-run estimate + actual breakdown
  Markdown.tsx, ui/...         # shared
lib/
  store.ts                     # Zustand: keyStore + runStore
  crypto/keys.ts               # AES-GCM + PBKDF2
  sse.ts                       # SSE parser used by all client streams
  sseEmit.ts                   # server-side SSE event emitters
  synthesizer.ts               # provider-agnostic streamChat()
  cost.ts                      # estimates + breakdown
  export/buildPayload.ts       # markdown export assembler
  prompts/{research-system,critique-template,synthesis-system}.ts
  providers/{anthropic,mistral,openai,gemini,critique,synthesis,followup}.ts
project-spec.md                # original architecture spec
```

---

## Known limitations

Documented honestly so you know what you're getting:

1. **OpenAI/Gemini cards stay blank for most of their run.** The snapshot polls don't expose in-flight progress (verified empirically: status reads `in_progress` with `searches=0 chars=0` for the entire run, then jumps to final state at completion). The fix is switching to the SDKs' streaming-from-background variants (`responses.stream(id)` / `interactions.get(id, {stream:true})`) — non-trivial, not landed yet.
2. **No proper in-flight cancel.** React strict mode in dev was tearing down `AbortController.abort()` in cleanup before the fetch reached the server, so the cleanup-abort was removed entirely. Retry works (re-fires the runner); mid-stream cancel doesn't. A real fix uses a ref-tracked controller that survives strict-mode's cleanup-then-setup cycle.
3. **DOCX export** flattens hyperlinks to `text (url)` and tables to lines. Full hyperlink runs and table grids are easy add-ons but not done.
4. **Cost is line-item-based**, not token-level. Anthropic and OpenAI already populate per-call usage in their done event; Mistral and Gemini providers don't surface theirs yet. Final cost number is an estimate ±20%.
5. **Refresh = lose run.** Run state is in-memory Zustand — no persistence. By design (spec confirmed) but it bites if you accidentally Cmd+R during a long deep-research call.
6. **`anthropic-dangerous-direct-browser-access` browser-direct path** was tried and abandoned — it hung on at least one common dev setup (likely a CORS-preflight extension issue). Everything goes through the Next.js proxy now. Trade-off: on Vercel Hobby's 60s function timeout, very long Claude runs (>60s) will 504 in production. Pro lifts the cap to 300s.

---

## What's in the repo

- [`project-spec.md`](project-spec.md) — the original architecture spec this app was built from
- [`claude-code-prompt.md`](claude-code-prompt.md) — the kickoff prompt that drove the build
- All source under `app/`, `components/`, `lib/`

---

## License

No license file yet — usage rights are unspecified. Add one (MIT is the usual default for permissive open source) before relying on it for anything serious.
