"use client";

import { useState } from "react";
import { Download, FileText, FileType2, FileType, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildExportPayload } from "@/lib/export/buildPayload";
import type { ResearchRun } from "@/lib/store";

type Format = "md" | "docx" | "pdf";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportButtons({ run }: { run: ResearchRun }) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const synthDone = run.synthesis.status === "done";
  const synthHasContent = run.synthesis.markdown.trim().length > 0;

  async function handleExport(format: Format) {
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      const payload = buildExportPayload(run);
      if (format === "md") {
        const blob = new Blob([payload.markdown], {
          type: "text/markdown;charset=utf-8",
        });
        triggerDownload(blob, `${payload.filenameStem}.md`);
      } else {
        const r = await fetch(`/api/export/${format}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            markdown: payload.markdown,
            filenameStem: payload.filenameStem,
          }),
        });
        if (!r.ok) {
          const msg = await r.text().catch(() => "");
          throw new Error(`Export failed: HTTP ${r.status}${msg ? ` — ${msg.slice(0, 200)}` : ""}`);
        }
        const blob = await r.blob();
        triggerDownload(blob, `${payload.filenameStem}.${format}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  const disabled = !synthHasContent;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <Download className="h-4 w-4 text-muted-foreground" />
      <span className="mr-2 text-xs text-muted-foreground">
        Export {synthDone ? "report" : synthHasContent ? "(in progress — partial)" : "(waiting for synthesis)"}:
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy === "md"}
        onClick={() => handleExport("md")}
      >
        {busy === "md" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
        Markdown
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy === "docx"}
        onClick={() => handleExport("docx")}
      >
        {busy === "docx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileType2 className="h-4 w-4" />}
        Word (.docx)
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy === "pdf"}
        onClick={() => handleExport("pdf")}
      >
        {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileType className="h-4 w-4" />}
        PDF
      </Button>
      {error && (
        <span className="ml-2 text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
