import { create } from "zustand";
import type { Critique, Provider, ProviderKeys, Source } from "@/lib/types";
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
  | "failed"
  | "critiquing"
  | "critique_done";

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

export type SynthesisStatus =
  | "idle"
  | "writing"
  | "done"
  | "failed";

export interface SynthesisState {
  status: SynthesisStatus;
  markdown: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  synthesizer?: Provider;
}

export interface ResearchRun {
  id: string;
  question: string;
  contextDocs?: { name: string; text: string }[];
  synthesizerProvider: Provider;
  startedAt: number;
  providers: Partial<Record<Provider, ProviderRun>>;
  // Track which providers have been kicked off so React Strict Mode's double-effect
  // doesn't fire two upstream calls per provider.
  launched: Partial<Record<Provider, boolean>>;
  // Stage 2 — flat list of critiques (fromProvider X ofProvider).
  critiques: Critique[];
  // Per-provider flag — has this provider's critique pass been launched?
  critiqueLaunched: Partial<Record<Provider, boolean>>;
  // Stage 3 — the synthesized final report.
  synthesis: SynthesisState;
  synthesisLaunched: boolean;
}

interface RunStoreState {
  current: ResearchRun | null;

  startRun: (
    id: string,
    question: string,
    contextDocs?: { name: string; text: string }[],
    synthesizerProvider?: Provider,
  ) => void;
  reset: () => void;

  initProvider: (provider: Provider) => void;
  markLaunched: (provider: Provider) => boolean; // returns true on first call only
  setStatus: (provider: Provider, status: ProviderRunStatus, detail?: string) => void;
  appendMarkdown: (provider: Provider, delta: string) => void;
  appendSources: (provider: Provider, sources: Source[]) => void;
  appendSearchQuery: (provider: Provider, query: string) => void;
  setError: (provider: Provider, error: string) => void;

  markCritiqueLaunched: (provider: Provider) => boolean;
  addCritiques: (critiques: Critique[]) => void;

  /** Reset a single provider's state so it can be re-launched. */
  resetProvider: (provider: Provider) => void;

  markSynthesisLaunched: (synthesizer: Provider) => boolean;
  setSynthesisStatus: (status: SynthesisStatus, error?: string) => void;
  appendSynthesisMarkdown: (delta: string) => void;
  resetSynthesis: () => void;
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

  startRun: (id, question, contextDocs, synthesizerProvider) => {
    set({
      current: {
        id,
        question,
        contextDocs,
        synthesizerProvider: synthesizerProvider ?? "anthropic",
        startedAt: Date.now(),
        providers: {},
        launched: {},
        critiques: [],
        critiqueLaunched: {},
        synthesis: { status: "idle", markdown: "" },
        synthesisLaunched: false,
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

  markCritiqueLaunched: (provider) => {
    const cur = get().current;
    if (!cur) return false;
    if (cur.critiqueLaunched[provider]) return false;
    set({
      current: {
        ...cur,
        critiqueLaunched: { ...cur.critiqueLaunched, [provider]: true },
      },
    });
    return true;
  },

  addCritiques: (critiques) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: { ...cur, critiques: [...cur.critiques, ...critiques] },
    });
  },

  resetProvider: (provider) => {
    const cur = get().current;
    if (!cur) return;
    const { [provider]: _drop, ...remainingLaunched } = cur.launched;
    void _drop;
    const { [provider]: _drop2, ...remainingProviders } = cur.providers;
    void _drop2;
    set({
      current: {
        ...cur,
        providers: remainingProviders,
        launched: remainingLaunched,
      },
    });
  },

  markSynthesisLaunched: (synthesizer) => {
    const cur = get().current;
    if (!cur) return false;
    if (cur.synthesisLaunched) return false;
    set({
      current: {
        ...cur,
        synthesisLaunched: true,
        synthesis: {
          ...cur.synthesis,
          status: "writing",
          startedAt: Date.now(),
          synthesizer,
        },
      },
    });
    return true;
  },

  setSynthesisStatus: (status, error) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: {
        ...cur,
        synthesis: {
          ...cur.synthesis,
          status,
          error: error ?? cur.synthesis.error,
          endedAt:
            status === "done" || status === "failed"
              ? Date.now()
              : cur.synthesis.endedAt,
        },
      },
    });
  },

  appendSynthesisMarkdown: (delta) => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: {
        ...cur,
        synthesis: {
          ...cur.synthesis,
          markdown: cur.synthesis.markdown + delta,
        },
      },
    });
  },

  resetSynthesis: () => {
    const cur = get().current;
    if (!cur) return;
    set({
      current: {
        ...cur,
        synthesisLaunched: false,
        synthesis: { status: "idle", markdown: "" },
      },
    });
  },
}));
