"use client";

import { KeyPanel } from "@/components/KeyPanel";
import { QuestionInput } from "@/components/QuestionInput";
import { useKeyStore } from "@/lib/store";

export default function HomePage() {
  const keys = useKeyStore((s) => s.keys);

  return (
    <main className="container mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">
          Parallel Research
        </h1>
        <p className="mt-2 text-muted-foreground">
          Deep research across Claude, ChatGPT, Mistral, and Gemini. They
          critique each other. You get one synthesized answer.
        </p>
      </header>

      <div className="space-y-6">
        <KeyPanel />
        {keys && <QuestionInput />}
      </div>

      <footer className="mt-10 text-xs text-muted-foreground">
        Your API keys live only in this browser. Encrypted at rest with
        AES-GCM. Sent over HTTPS straight to each provider as a bearer
        token, then discarded.
      </footer>
    </main>
  );
}
