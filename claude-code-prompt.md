# Claude Code — Project Kickoff Prompt

Copy everything below this line into your Claude Code session.

---

I'm building a web app called **Parallel Research**: it runs deep research concurrently across Claude, ChatGPT, Mistral, and Gemini, has the four models critique each other's outputs, and produces one synthesized final document. The complete spec is in `project-spec.md` in this repo. **Read it end to end before writing any code.** Sections 4 (architecture), 5 (pipeline), 6 (tech stack), and 12 (build sequence) are your primary reference.

The thesis behind the app: any single model has blind spots. Four working in parallel plus cross-critique surfaces both consensus (high-confidence) and disagreement (worth investigating) better than any one model alone.

## How we'll work together

1. **The spec is authoritative.** If you want to deviate from it (different library, different file layout, different pattern), stop and ask first. Don't silently change scope.

2. **Build in the order in spec section 12.** Each step ships something testable. Do not start step N+1 until step N is actually verified working in the browser. The order is intentional — it gets one provider end-to-end before the others, so integration issues surface early.

3. **One provider at a time.** Get Claude (Anthropic) working end-to-end through Stage 1 — research call, SSE streaming, sources rendered in a card — before adding the other three. The others slot into the same shape once the first one works.

4. **Stop after each milestone.** At a minimum after spec steps 3, 6, 8, 10, and 12, stop and tell me what's working before continuing. Show me a screenshot or a quick demo recipe ("run `pnpm dev`, paste this key, type this question").

5. **Small commits.** Commit per logical step with clear messages. I want to be able to bisect if something breaks.

6. **Ask before assuming on anything ambiguous.** If the spec is unclear on something concrete (exact prompt wording, error UI copy, edge-case behavior), ask. If it's a small judgment call (which Tailwind class, which utility file), just decide and note it in your commit message.

## Phase 0 — before you write any code

Do these first, in order:

1. Read `project-spec.md` end to end.
2. **Verify the provider API surfaces.** The spec was written based on a May 2026 snapshot — APIs move. For each of the four providers, hit their current docs and confirm:
   - Model names in the spec are still valid (`claude-opus-4-7`, `o3-deep-research-2025-06-26`, `deep-research-preview-04-2026`, `mistral-medium-latest`)
   - Tool/endpoint names are unchanged (Anthropic `web_search_20260209`, OpenAI Responses API + `background: true`, Gemini `/v1beta/interactions`, Mistral beta Agents API)
   - The SDK versions you're about to install are current
   
   If anything has changed, flag it before scaffolding so we can update the spec.

3. Confirm you've read the spec and report back any open questions before touching code.

## Specific guardrails — things to be careful about

- **API keys are sensitive.** Never log them, never commit them, never persist them on the server. Keys live in browser localStorage encrypted with a session passphrase via the Web Crypto API. They're sent in each request body to our API and discarded after the upstream call completes. Do not store keys in env vars in committed code.

- **Vercel function timeouts.** Hobby caps at 60s, Pro at 300s. Claude/Mistral approximated research calls can take 30–90s — use streaming responses (which keep the connection open) and set `maxDuration` explicitly on those routes. The polling routes for OpenAI/Gemini are fast (just check upstream status) and don't need long timeouts.

- **OpenAI Deep Research requires a verified org.** If the user's key returns 403, surface a specific, actionable error message — don't show a generic failure.

- **Pin Gemini model snapshots.** Interactions API is in public preview. Use the exact snapshot string from the spec, not `latest` aliases.

- **Mistral is approximated.** No Deep Research API exists. Use the Agents API + `web_search` tool. Label Mistral's output as "approximated" in the UI so users aren't surprised it's shorter than the other three.

- **Stage 2 and Stage 3 use base chat models, not deep research models.** Critiques and synthesis are fast LLM calls. Don't accidentally route them through `o3-deep-research` or `deep-research-preview` — that would turn each critique into a 5–30 minute job.

- **Stage 1 fires all 4 in parallel.** Wall time = slowest provider. Don't serialize them.

- **Don't add scope.** No database, no auth, no Inngest, no queue system, no Redis. v1 is request-scoped and browser-local. If you find yourself reaching for one of these, stop and ask.

## What "done" means for v1

- User pastes 4 API keys → encrypted in browser localStorage
- User submits a research question (optionally uploads a PDF as context)
- A cost estimate shows before kickoff
- All 4 models run in parallel, each card streams its progress and renders its raw report when done
- Once all 4 finish, 4 critiques fire in parallel and render inside their respective cards
- Claude (default synthesizer, configurable) generates the final structured report, streamed into the page below the cards
- Final report has: question → exec summary → per-model raw answers (collapsible) → comparison table → consensus → disagreements → sources → recommendation
- User can export the report as Markdown, PDF, or DOCX
- User can ask one follow-up question against the finished report
- Actual run cost shows at the end

No sign-in, no DB, no history. Pure ephemeral session in the browser.

## Start now

1. Read `project-spec.md`.
2. Run the Phase 0 verification on the four provider APIs.
3. Report back what you found and any questions.
4. After I confirm, start with spec section 12 step 1 (scaffold) and work through in order, stopping at the milestones noted above.

Don't rush. I'd rather have one provider working perfectly than four working badly.
