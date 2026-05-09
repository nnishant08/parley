import OpenAI from "openai";
import { Mistral } from "@mistralai/mistralai";
import { GoogleGenAI } from "@google/genai";
import { sseError, sseMessageStop, sseTextDelta } from "@/lib/sseEmit";
import { parseSseStream } from "@/lib/sse";
import type { Provider } from "@/lib/types";

/**
 * Provider-agnostic streaming chat completion. Used by both
 * synthesize and followup routes. The result is always a stream of
 * Anthropic-shaped SSE events (via lib/sseEmit) so the browser
 * client only needs one parser.
 *
 * Models per spec section 5 + Phase 0 verification:
 *   anthropic: claude-opus-4-7
 *   openai:    gpt-5.5
 *   gemini:    gemini-2.5-pro
 *   mistral:   mistral-medium-latest
 */
const SYNTH_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-5.5",
  gemini: "gemini-2.5-pro",
  mistral: "mistral-medium-latest",
};

interface Args {
  provider: Provider;
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export function streamChat(args: Args): ReadableStream<Uint8Array> {
  switch (args.provider) {
    case "anthropic":
      return streamAnthropic(args);
    case "openai":
      return streamOpenAI(args);
    case "gemini":
      return streamGemini(args);
    case "mistral":
      return streamMistral(args);
  }
}

// ──────────────────────────────────────────────────────────
// Anthropic — pipe upstream SSE through with no translation
// ──────────────────────────────────────────────────────────
function streamAnthropic(args: Args): ReadableStream<Uint8Array> {
  const t0 = Date.now();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // eslint-disable-next-line no-console
        console.log(
          `[synth/anthropic] POST upstream — input ${args.userMessage.length.toLocaleString()} chars`,
        );
        const upstream = await fetch(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "text/event-stream",
              "x-api-key": args.apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: SYNTH_MODEL.anthropic,
              max_tokens: args.maxTokens ?? 16000,
              system: args.systemPrompt,
              messages: [{ role: "user", content: args.userMessage }],
              stream: true,
            }),
            signal: args.signal,
          },
        );
        // eslint-disable-next-line no-console
        console.log(
          `[synth/anthropic] upstream responded ${upstream.status} after ${Date.now() - t0}ms`,
        );
        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          // eslint-disable-next-line no-console
          console.error(
            `[synth/anthropic] non-OK from upstream: ${text.slice(0, 200)}`,
          );
          controller.enqueue(sseError(`Anthropic ${upstream.status}: ${text.slice(0, 300)}`));
          controller.close();
          return;
        }
        const reader = upstream.body.getReader();
        let chunkCount = 0;
        let totalBytes = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunkCount++;
            totalBytes += value.byteLength;
            if (chunkCount === 1) {
              // eslint-disable-next-line no-console
              console.log(
                `[synth/anthropic] first chunk @ ${Date.now() - t0}ms (${value.byteLength} bytes)`,
              );
            }
            controller.enqueue(value);
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `[synth/anthropic] stream done — ${chunkCount} chunks, ${totalBytes} bytes, ${Date.now() - t0}ms`,
        );
        controller.close();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[synth/anthropic] stream error:", e);
        controller.enqueue(
          sseError(e instanceof Error ? e.message : "Anthropic stream failed"),
        );
        controller.close();
      }
    },
  });
}

// ──────────────────────────────────────────────────────────
// OpenAI — chat.completions.create stream → text deltas
// ──────────────────────────────────────────────────────────
function streamOpenAI(args: Args): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = new OpenAI({ apiKey: args.apiKey, maxRetries: 6 });
        const stream = await client.chat.completions.create({
          model: SYNTH_MODEL.openai,
          messages: [
            { role: "system", content: args.systemPrompt },
            { role: "user", content: args.userMessage },
          ],
          stream: true,
          max_completion_tokens: args.maxTokens ?? 16000,
        });
        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text.length > 0) {
            controller.enqueue(sseTextDelta(text));
          }
        }
        controller.enqueue(sseMessageStop());
        controller.close();
      } catch (e) {
        controller.enqueue(
          sseError(e instanceof Error ? e.message : "OpenAI stream failed"),
        );
        controller.close();
      }
    },
  });
}

// ──────────────────────────────────────────────────────────
// Gemini — models.generateContentStream → text deltas
// ──────────────────────────────────────────────────────────
function streamGemini(args: Args): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const ai = new GoogleGenAI({ apiKey: args.apiKey });
        const stream = await ai.models.generateContentStream({
          model: SYNTH_MODEL.gemini,
          contents: [{ role: "user", parts: [{ text: args.userMessage }] }],
          config: { systemInstruction: args.systemPrompt },
        });
        for await (const chunk of stream) {
          const text = chunk.text;
          if (typeof text === "string" && text.length > 0) {
            controller.enqueue(sseTextDelta(text));
          }
        }
        controller.enqueue(sseMessageStop());
        controller.close();
      } catch (e) {
        controller.enqueue(
          sseError(e instanceof Error ? e.message : "Gemini stream failed"),
        );
        controller.close();
      }
    },
  });
}

// ──────────────────────────────────────────────────────────
// Mistral — chat.stream → text deltas
// ──────────────────────────────────────────────────────────
function streamMistral(args: Args): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = new Mistral({ apiKey: args.apiKey });
        const stream = await client.chat.stream({
          model: SYNTH_MODEL.mistral,
          messages: [
            { role: "system", content: args.systemPrompt },
            { role: "user", content: args.userMessage },
          ],
          maxTokens: args.maxTokens ?? 16000,
        });
        for await (const chunk of stream) {
          // Mistral's stream chunks have shape { data: { choices: [{ delta: { content }}] } }
          const delta = (chunk as { data?: { choices?: Array<{ delta?: { content?: string | unknown[] } }> } })
            .data?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            controller.enqueue(sseTextDelta(delta));
          } else if (Array.isArray(delta)) {
            for (const c of delta) {
              if (
                typeof c === "object" &&
                c &&
                "type" in c &&
                (c as { type: string }).type === "text" &&
                "text" in c
              ) {
                const t = (c as { text: string }).text;
                if (typeof t === "string" && t.length > 0)
                  controller.enqueue(sseTextDelta(t));
              }
            }
          }
        }
        controller.enqueue(sseMessageStop());
        controller.close();
      } catch (e) {
        controller.enqueue(
          sseError(e instanceof Error ? e.message : "Mistral stream failed"),
        );
        controller.close();
      }
    },
  });
}

// Re-export for routes that need to parse upstream SSE before re-emitting
export { parseSseStream };
