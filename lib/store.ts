import { create } from "zustand";
import type { ProviderKeys } from "@/lib/types";
import {
  clearEncryptedBlob,
  decryptKeys,
  encryptKeys,
  hasStoredKeys,
  loadEncryptedBlob,
  saveEncryptedBlob,
} from "@/lib/crypto/keys";

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

  hydrate: () => {
    set({ hasBlob: hasStoredKeys(), hydrated: true });
  },

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

  lock: () => {
    set({ keys: null, passphrase: null, unlockError: null });
  },
}));
