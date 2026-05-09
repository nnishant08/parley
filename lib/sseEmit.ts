/**
 * Helpers for emitting Anthropic-shaped SSE events from any upstream
 * provider, so our client-side SSE parser only needs to know one
 * format. Used by synthesize + followup routes.
 *
 * Emits these event types (matching anthropic's wire format):
 *   - content_block_delta { delta: { type: "text_delta", text } }
 *   - message_stop {}
 *   - error { error: { message } }
 */
const enc = new TextEncoder();

export function sseTextDelta(text: string): Uint8Array {
  const data = JSON.stringify({
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  });
  return enc.encode(`event: content_block_delta\ndata: ${data}\n\n`);
}

export function sseMessageStop(): Uint8Array {
  return enc.encode(
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  );
}

export function sseError(message: string): Uint8Array {
  const data = JSON.stringify({
    type: "error",
    error: { type: "stream_error", message },
  });
  return enc.encode(`event: error\ndata: ${data}\n\n`);
}
