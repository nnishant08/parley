"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKeyStore } from "@/lib/store";
import { validateKeyFormat } from "@/lib/crypto/keys";
import { PROVIDERS, PROVIDER_LABEL, type Provider, type ProviderKeys } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";

const PROVIDER_HINT: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  gemini: "AIza…",
  mistral: "(any long secret)",
};

const PROVIDER_DOCS: Record<Provider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  mistral: "https://console.mistral.ai/api-keys/",
};

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function KeyPanel() {
  const {
    keys,
    hasBlob,
    hydrated,
    unlockError,
    hydrate,
    saveKeys,
    unlock,
    forget,
    lock,
  } = useKeyStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (keys) return <UnlockedView keys={keys} onLock={lock} onForget={forget} />;
  if (hasBlob) return <UnlockView onUnlock={unlock} error={unlockError} onForget={forget} />;
  return <SetupView onSave={saveKeys} />;
}

function SetupView({
  onSave,
}: {
  onSave: (keys: ProviderKeys, passphrase: string) => Promise<void>;
}) {
  const [values, setValues] = useState<ProviderKeys>({
    anthropic: "",
    openai: "",
    gemini: "",
    mistral: "",
  });
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState<Record<Provider, boolean>>({
    anthropic: false,
    openai: false,
    gemini: false,
    mistral: false,
  });
  const [submitting, setSubmitting] = useState(false);

  const formatErrors: Record<Provider, boolean> = {
    anthropic: values.anthropic !== "" && !validateKeyFormat("anthropic", values.anthropic),
    openai: values.openai !== "" && !validateKeyFormat("openai", values.openai),
    gemini: values.gemini !== "" && !validateKeyFormat("gemini", values.gemini),
    mistral: values.mistral !== "" && !validateKeyFormat("mistral", values.mistral),
  };

  const allFilled = PROVIDERS.every((p) => values[p].trim().length > 0);
  const allValid = PROVIDERS.every((p) => validateKeyFormat(p, values[p].trim()));
  const passphraseOk = passphrase.length >= 6;
  const canSubmit = allFilled && allValid && passphraseOk && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const trimmed: ProviderKeys = {
        anthropic: values.anthropic.trim(),
        openai: values.openai.trim(),
        gemini: values.gemini.trim(),
        mistral: values.mistral.trim(),
      };
      await onSave(trimmed, passphrase);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Paste your four API keys</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Encrypted in your browser with AES-GCM (PBKDF2-derived from your passphrase). Never sent to our server except as the bearer token to each provider.
      </p>

      <div className="mt-6 grid gap-4">
        {PROVIDERS.map((p) => (
          <div key={p}>
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`key-${p}`} className="capitalize">
                {PROVIDER_LABEL[p]}
              </Label>
              <a
                href={PROVIDER_DOCS[p]}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                Where to find this →
              </a>
            </div>
            <div className="mt-1.5 flex gap-2">
              <Input
                id={`key-${p}`}
                type={show[p] ? "text" : "password"}
                value={values[p]}
                onChange={(e) => setValues({ ...values, [p]: e.target.value })}
                placeholder={PROVIDER_HINT[p]}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  "font-mono",
                  formatErrors[p] && "border-destructive focus-visible:ring-destructive",
                )}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShow({ ...show, [p]: !show[p] })}
                aria-label={show[p] ? "Hide key" : "Show key"}
              >
                {show[p] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {formatErrors[p] && (
              <p className="mt-1 text-xs text-destructive">
                That doesn't look like a {PROVIDER_LABEL[p]} key. Expected pattern: {PROVIDER_HINT[p]}
              </p>
            )}
          </div>
        ))}

        <div className="mt-2 border-t border-border pt-4">
          <Label htmlFor="passphrase">Session passphrase</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Used to encrypt your keys in localStorage. Pick something you'll remember for this session — we can't recover it.
          </p>
          <Input
            id="passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="At least 6 characters"
            className="mt-2"
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" disabled={!canSubmit} className="mt-2">
          {submitting ? "Encrypting…" : "Save & continue"}
        </Button>
      </div>
    </form>
  );
}

function UnlockView({
  onUnlock,
  error,
  onForget,
}: {
  onUnlock: (passphrase: string) => Promise<boolean>;
  error: string | null;
  onForget: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase || busy) return;
    setBusy(true);
    try {
      const ok = await onUnlock(passphrase);
      if (ok) setPassphrase("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Welcome back</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your passphrase to unlock your saved API keys.
      </p>
      <div className="mt-4 flex gap-2">
        <Input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          autoComplete="current-password"
        />
        <Button type="submit" disabled={!passphrase || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onForget}
        className="mt-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Trash2 className="h-3 w-3" />
        Forgot passphrase — clear stored keys
      </button>
    </form>
  );
}

function UnlockedView({
  keys,
  onLock,
  onForget,
}: {
  keys: ProviderKeys;
  onLock: () => void;
  onForget: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedKey, setCopiedKey] = useState<Provider | null>(null);

  async function copyAll() {
    const json = JSON.stringify(keys, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      // fall back to a textarea trick
      const ta = document.createElement("textarea");
      ta.value = json;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    }
  }

  async function copyOne(p: Provider) {
    try {
      await navigator.clipboard.writeText(keys[p]);
      setCopiedKey(p);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Unlock className="h-4 w-4 text-emerald-500" />
          <h2 className="font-semibold">Keys unlocked</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setReveal((r) => !r)}>
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {reveal ? "Hide" : "Show"}
          </Button>
          <Button size="sm" variant="outline" onClick={copyAll}>
            {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedAll ? "Copied" : "Copy all (JSON)"}
          </Button>
          <Button size="sm" variant="outline" onClick={onLock}>
            Lock
          </Button>
          <Button size="sm" variant="ghost" onClick={onForget}>
            Forget all
          </Button>
        </div>
      </div>
      <ul className="mt-4 grid gap-2 text-sm">
        {PROVIDERS.map((p) => (
          <li
            key={p}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <span className="font-medium shrink-0">{PROVIDER_LABEL[p]}</span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground",
                reveal ? "text-right" : "text-right",
              )}
              title={reveal ? keys[p] : undefined}
            >
              {reveal ? keys[p] : maskKey(keys[p])}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() => copyOne(p)}
              aria-label={`Copy ${PROVIDER_LABEL[p]} key`}
            >
              {copiedKey === p ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </li>
        ))}
      </ul>
      {reveal && (
        <p className="mt-3 text-xs text-muted-foreground">
          Keys are visible. Copy what you need, then click Hide.
        </p>
      )}
    </div>
  );
}
