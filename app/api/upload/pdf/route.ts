import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spec section 11.7: cap context to ~50k tokens.
// Rough heuristic: 1 token ≈ 4 chars, so ~200,000 chars.
const MAX_CHARS = 200_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: `File too large (${Math.round(file.size / 1024 / 1024)} MB > 25 MB cap)` },
      { status: 413 },
    );
  }
  if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json(
      { error: "Only PDF files are supported." },
      { status: 415 },
    );
  }

  let text = "";
  let pageCount = 0;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    pageCount = pdf.numPages;
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[upload/pdf] extract failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "PDF extraction failed" },
      { status: 422 },
    );
  }

  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n[…document truncated for context window…]";
    truncated = true;
  }

  return Response.json({
    name: file.name,
    text,
    pageCount,
    chars: text.length,
    truncated,
  });
}
