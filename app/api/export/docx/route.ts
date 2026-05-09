import { NextRequest } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
} from "docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  markdown: string;
  filenameStem: string;
}

/**
 * Lightweight markdown → docx mapping. Not a full parser — handles
 * the subset our synth prompt actually emits: H1/H2/H3, paragraphs,
 * unordered + ordered lists, bold/italic inline, and links (rendered
 * as their text). Tables are flattened to lines (the synthesizer's
 * comparison table will still be readable, just without grid lines —
 * full table rendering is on the step-15 polish list).
 */
function paragraphsFromMarkdown(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (/^# /.test(line)) {
      out.push(
        new Paragraph({
          text: line.replace(/^#\s+/, ""),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }),
      );
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      out.push(
        new Paragraph({
          text: line.replace(/^##\s+/, ""),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
      );
      i++;
      continue;
    }
    if (/^### /.test(line)) {
      out.push(
        new Paragraph({
          text: line.replace(/^###\s+/, ""),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }),
      );
      i++;
      continue;
    }
    // Horizontal rule
    if (/^[-_*]{3,}\s*$/.test(line)) {
      out.push(new Paragraph({ text: "" }));
      out.push(
        new Paragraph({
          children: [new TextRun({ text: "—".repeat(40) })],
        }),
      );
      out.push(new Paragraph({ text: "" }));
      i++;
      continue;
    }
    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, "");
      out.push(
        new Paragraph({
          children: parseInline(text),
          bullet: { level: 0 },
        }),
      );
      i++;
      continue;
    }
    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const text = line.replace(/^\s*\d+\.\s+/, "");
      out.push(
        new Paragraph({
          children: parseInline(text),
          numbering: { reference: "default-numbering", level: 0 },
        }),
      );
      i++;
      continue;
    }
    // Blank line
    if (line.trim() === "") {
      out.push(new Paragraph({ text: "" }));
      i++;
      continue;
    }
    // Paragraph (collect contiguous non-empty, non-special lines)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|\s*[-*]\s+|\s*\d+\.\s+|[-_*]{3,}\s*$)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(
      new Paragraph({
        children: parseInline(buf.join(" ")),
        spacing: { after: 120 },
      }),
    );
  }
  return out;
}

/**
 * Inline pass: split text into TextRuns honoring **bold**, *italic*,
 * `code`, and [text](url). Strict-enough subset that doesn't try to
 * be a real parser; mismatched tokens fall through as literal.
 */
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Replace markdown links with their text (we lose URLs in DOCX
  // hyperlink format — adding hyperlink runs needs ExternalHyperlink
  // which the docx lib supports but balloons code; v1 keeps it text).
  const linkified = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Greedy emphasis matcher; cycles through styled tokens.
  const re =
    /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linkified)) !== null) {
    if (m.index > lastIdx) {
      runs.push(new TextRun(linkified.slice(lastIdx, m.index)));
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      runs.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    } else if (tok.startsWith("*")) {
      runs.push(new TextRun({ text: tok.slice(1, -1), italics: true }));
    } else if (tok.startsWith("`")) {
      runs.push(
        new TextRun({
          text: tok.slice(1, -1),
          font: "Courier New",
        }),
      );
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < linkified.length) {
    runs.push(new TextRun(linkified.slice(lastIdx)));
  }
  if (runs.length === 0) runs.push(new TextRun(linkified));
  return runs;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const { markdown, filenameStem } = body;
  if (!markdown) {
    return new Response("Missing markdown", { status: 400 });
  }

  const doc = new Document({
    creator: "Parallel Research",
    title: filenameStem,
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "left",
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: paragraphsFromMarkdown(markdown),
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  return new Response(ab, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${filenameStem}.docx"`,
    },
  });
}
