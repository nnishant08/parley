import { create } from "zustand";
import type { Provider, ProviderKeys, Source } from "@/lib/types";
import {
  clearEncryptedBlob,
  decryptKeys,
  encryptKeys,
  hasStoredKeys,
  loadEncryptedBlob,
  saveEncryptedBlob,
} from "@/lib/crypto/keys";

// ──────────────────────────── KEY STORE ────────────────────────────

interface KeyStoreState {
  keys: ProviderKeys | null;
  passphrase: string | null;
  hasBlob: boolean;
  unlockError: string | null;
  hydrated: boolean;

  hydrate: () => void;
  saveKeys: (keys: ProviderKeys, passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  forget: () => void;
  lock: () => void;
}

export const useKeyStore = create<KeyStoreState>((set) => ({
  keys: null,
  passphrase: null,
  hasBlob: false,
  unlockError: null,
  hydrated: false,

  hydrate: () => set({ hasBlob: hasStoredKeys(), hydrated: true }),

  saveKeys: async (keys, passphrase) => {
    const blob = await encryptKeys(keys, passphrase);
    saveEncryptedBlob(blob);
    set({ keys, passphrase, hasBlob: true, unlockError: null });
  },

  unlock: async (passphrase) => {
    const blob = loadEncryptedBlob();
    if (!blob) {
      set({ unlockError: "No saved keys found." });
      return false;
    }
    try {
      const keys = await decryptKeys(blob, passphrase);
      set({ keys, passphrase, unlockError: null });
      return true;
    } catch {
      set({ unlockError: "Wrong passphrase." });
      return false;
    }
  },

  forget: () => {
    clearEncryptedBlob();
    set({ keys: null, passphrase: null, hasBlob: false, unlockError: null });
  },

  lock: () => set({ keys: null, passphrase: null, unlockError: null }),
}));

// ──────────────────────────── RUN STORE ────────────────────────────

export type ProviderRunStatus =
  | "idle"
  | "planning"
  | "searching"
  | "writing"
  | "done"
  | "failed";

export interface ProviderRun {
  status: ProviderRunStatus;
  detail?: string;
  markdown: string;
  sources: Source[];
  searchQueries: string[];
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

const emptyRun = (): ProviderRun => ({
  status: "idle",
  markdown: "",
  sources: [],
  searchQueries: [],
});

export interface ResearchRun {
  id: string;
  question: string;
  contextDocs?: { name: string; text: string }[];
  startedAt: number;
  providers: Partial<Record<Provider, ProviderRun>>;
  // Track which providers have been kicked off so React Strict Mode's double-effect
  // doesn't fire two upstream calls per provider.
  launched: Partial<Record<Provider, boolean>>;
}

interface RunStoreState {
  current: ResearchRun | null;

  startRun: (
    id: string,
    question: string,
    contextDocs?: { name: string; text: string }[],
  ) => void;
  reset: () => void;

  initProvider: (provider: Provider) => void;
  markLaunched: (provider: Provider) => boolean; // returns true on first call only
  setStatus: (provider: Provider, status: ProviderRunStatus, detail?: string) => void;
  appendMarkdown: (provider: Provider, delta: string) => void;
  appendSources: (provider: Provider, sources: Source[]) => void;
  appendSearchQuery: (provider: Provider, query: string) => void;
  setError: (provider: Provider, error: string) => void;
}

function patchProvider(
  run: ResearchRun,
  provider: Provider,
  patch: (p: ProviderRun) => ProviderRun,
): ResearchRun {
  const prev = run.providers[provider] ?? emptyRun();
  return {
    ...run,
    providers: { ...run.providers, [provider]: patch(prev) },
  };
}

export const useRunStore = create<RunStoreState>((set, get) => ({
  current: null,

  startRun: (id, question, contextDocs) => {
    set({
      current: {
        id,
        question,
        contextDocs,
        startedAt: Date.now(),
        providers: {},
        launched: {},
      },
    });
  },

  reset: () => set({ current: null }),

  initProvider: (provider) => {
    const cur = get().current;
    if (!cur) return;
    if (cur.providers[provider]) return;
    set({
      current: {
        ...cur,
        providers: { ...cur.providers, [provider]: emptyRun() },
      },
    });
  },

  markLaunched: (provider) => {
    const cur = get().current;
    if (!cur) return false;
    if (cur.launched[provider]) return false;
    set({
      current: { ...cur, launched: { ...cur.launched, [provider]: true } },
    });
    return true;
  },

  setStatus: (provider, status, detail) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: patchProvider(cur, provider, (p) => ({
        ...p,
        status,
        detail: detail ?? p.detail,
        startedAt: p.startedAt ?? Date.now(),
        endedAt: status === "done" || status === "failed" ? Date.now() : p.endedAt,
      })),
    });
  },

  appendMarkdown: (provider, delta) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: patchProvider(cur, provider, (p) => ({
        ...p,
        markdown: p.markdown + delta,
      })),
    });
  },

  appendSources: (provider, sources) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: patchProvider(cur, provider, (p) => {
        const seen = new Set(p.sources.map((s) => s.url));
        const merged = [...p.sources];
        for (const s of sources) {
          if (!seen.has(s.url)) {
            merged.push(s);
            seen.add(s.url);
          }
        }
        return { ...p, sources: merged };
      }),
    });
  },

  appendSearchQuery: (provider, query) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: patchProvider(cur, provider, (p) => ({
        ...p,
        searchQueries: [...p.searchQueries, query],
        detail: query,
      })),
    });
  },

  setError: (provider, error) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: patchProvider(cur, provider, (p) => ({
        ...p,
        status: "failed",
        error,
        endedAt: Date.now(),
      })),
    });
  },
}));
