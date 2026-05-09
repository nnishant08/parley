"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRunStore } from "@/lib/store";
import { PROVIDERS, PROVIDER_LABEL, type Provider } from "@/lib/types";
import {
  ArrowRight,
  Loader2,
  Paperclip,
  X,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PreRunCostEstimate } from "@/components/CostEstimate";

const SUGGESTIONS = [
  "What does the latest research say about GLP-1s and cognition?",
  "Compare current battery chemistries for grid storage in 2026.",
  "Is the housing market cooling or just pausing? US, Q2 2026.",
];

interface AttachedDoc {
  name: string;
  text: string;
  pageCount?: number;
  chars: number;
  truncated?: boolean;
}

export function QuestionInput() {
  const router = useRouter();
  const startRun = useRunStore((s) => s.startRun);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<AttachedDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [synthesizer, setSynthesizer] = useState<Provider>("anthropic");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    const runId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const contextDocs = attachments.map((a) => ({
      name: a.name,
      text: a.text,
    }));
    startRun(
      runId,
      q,
      contextDocs.length ? contextDocs : undefined,
      synthesizer,
    );
    router.push(`/research/${runId}`);
  }

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload/pdf", { method: "POST", body: fd });
      const json = (await r.json()) as Partial<AttachedDoc> & { error?: string };
      if (!r.ok || json.error || !json.text) {
        throw new Error(json.error || `Upload failed: HTTP ${r.status}`);
      }
      const text = json.text;
      setAttachments((prev) => [
        ...prev,
        {
          name: json.name ?? file.name,
          text,
          pageCount: json.pageCount,
          chars: json.chars ?? text.length,
          truncated: json.truncated,
        },
      ]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <Label htmlFor="question" className="text-base">
        Your research question
      </Label>
      <p className="mt-1 text-xs text-muted-foreground">
        Be specific. Time-bounded, scoped questions produce better reports.
      </p>
      <textarea
        id="question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="What is…"
        rows={4}
        className="mt-3 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />

      {/* Attachments */}
      {attachments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {attachments.map((a, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{a.name}</span>
              <span className="text-muted-foreground">
                {a.pageCount ? `${a.pageCount} pages · ` : ""}
                {a.chars.toLocaleString()} chars
                {a.truncated && (
                  <span className="ml-1 text-amber-300">(truncated)</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="ml-auto text-muted-foreground hover:text-foreground"
                aria-label="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploadError && (
        <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="h-3 w-3" /> {uploadError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Synthesizer:</span>
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSynthesizer(p)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              synthesizer === p
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {PROVIDER_LABEL[p]}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">
          (writes the final report; default Claude)
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Try:</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setQuestion(s)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {s.length > 40 ? s.slice(0, 40) + "…" : s}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            {uploading ? "Extracting…" : "Attach PDF"}
          </Button>
          <p className="text-xs text-muted-foreground">⌘+Enter to start</p>
        </div>
        <Button onClick={submit} disabled={!question.trim() || busy || uploading}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Starting…
            </>
          ) : (
            <>
              Start research <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
      <PreRunCostEstimate />
    </div>
  );
}
