import { NextRequest } from "next/server";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  markdown: string;
  filenameStem: string;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingHorizontal: 56,
    paddingBottom: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.45,
    color: "#222",
  },
  h1: { fontSize: 20, marginBottom: 8, marginTop: 8, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 14, marginBottom: 6, marginTop: 14, fontFamily: "Helvetica-Bold" },
  h3: { fontSize: 11, marginBottom: 4, marginTop: 10, fontFamily: "Helvetica-Bold" },
  paragraph: { marginBottom: 6 },
  bullet: { marginBottom: 3, paddingLeft: 12 },
  bulletDot: { width: 8 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#ddd", marginVertical: 10 },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  code: { fontFamily: "Courier", backgroundColor: "#f4f4f4" },
});

type InlineSegment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string };

function parseInline(text: string): InlineSegment[] {
  // Reduce links to "text (url)" — we don't render PDF links in v1.
  const linkified = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  const segs: InlineSegment[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linkified)) !== null) {
    if (m.index > lastIdx) segs.push({ type: "text", text: linkified.slice(lastIdx, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) segs.push({ type: "bold", text: tok.slice(2, -2) });
    else if (tok.startsWith("*")) segs.push({ type: "italic", text: tok.slice(1, -1) });
    else segs.push({ type: "code", text: tok.slice(1, -1) });
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < linkified.length) segs.push({ type: "text", text: linkified.slice(lastIdx) });
  if (segs.length === 0) segs.push({ type: "text", text: linkified });
  return segs;
}

function renderInline(segs: InlineSegment[], baseKey: string) {
  return segs.map((s, i) => {
    if (s.type === "text") return React.createElement(Text, { key: `${baseKey}-${i}` }, s.text);
    if (s.type === "bold")
      return React.createElement(Text, { key: `${baseKey}-${i}`, style: styles.bold }, s.text);
    if (s.type === "italic")
      return React.createElement(Text, { key: `${baseKey}-${i}`, style: styles.italic }, s.text);
    return React.createElement(Text, { key: `${baseKey}-${i}`, style: styles.code }, s.text);
  });
}

function blocksFromMarkdown(md: string): React.ReactNode[] {
  const lines = md.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b-${key++}`;

    if (/^# /.test(line)) {
      out.push(React.createElement(Text, { key: k, style: styles.h1 }, line.replace(/^#\s+/, "")));
      i++;
      continue;
    }
    if (/^## /.test(line)) {
      out.push(React.createElement(Text, { key: k, style: styles.h2 }, line.replace(/^##\s+/, "")));
      i++;
      continue;
    }
    if (/^### /.test(line)) {
      out.push(React.createElement(Text, { key: k, style: styles.h3 }, line.replace(/^###\s+/, "")));
      i++;
      continue;
    }
    if (/^[-_*]{3,}\s*$/.test(line)) {
      out.push(React.createElement(View, { key: k, style: styles.hr }));
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, "");
      out.push(
        React.createElement(
          Text,
          { key: k, style: styles.bullet },
          "• ",
          ...renderInline(parseInline(text), k),
        ),
      );
      i++;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const m = line.match(/^\s*(\d+)\.\s+(.+)/);
      if (m) {
        out.push(
          React.createElement(
            Text,
            { key: k, style: styles.bullet },
            `${m[1]}. `,
            ...renderInline(parseInline(m[2]), k),
          ),
        );
      }
      i++;
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Paragraph: collect contiguous non-empty non-special lines
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
      React.createElement(
        Text,
        { key: k, style: styles.paragraph },
        ...renderInline(parseInline(buf.join(" ")), k),
      ),
    );
  }
  return out;
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

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: styles.page },
      ...blocksFromMarkdown(markdown),
    ),
  );

  const buf = await renderToBuffer(doc);
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  return new Response(ab, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filenameStem}.pdf"`,
    },
  });
}
