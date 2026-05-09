/**
 * Minimal Server-Sent Events parser. Reads from a Response.body
 * (ReadableStream<Uint8Array>) and yields { event, data } pairs.
 *
 * Per the SSE spec: events are separated by a blank line; each event has
 * one or more "field: value" lines. We care about `event:` (optional, the
 * event name) and `data:` (the payload, possibly multi-line).
 */
export interface SseMessage {
  event?: string;
  data: string;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      // Spec allows \n\n or \r\n\r\n. We normalize.
      while ((idx = nextDelimiter(buffer)) !== -1) {
        const chunk = buffer.slice(0, idx.start);
        buffer = buffer.slice(idx.end);
        const msg = parseEvent(chunk);
        if (msg) yield msg;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function nextDelimiter(s: string): { start: number; end: number } | -1 {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a === -1 && b === -1) return -1;
  if (a === -1) return { start: b, end: b + 4 };
  if (b === -1) return { start: a, end: a + 2 };
  return a < b ? { start: a, end: a + 2 } : { start: b, end: b + 4 };
}

function parseEvent(chunk: string): SseMessage | null {
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine;
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0 && !eventName) return null;
  return { event: eventName, data: dataLines.join("\n") };
}
