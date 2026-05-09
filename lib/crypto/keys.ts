import type { Provider, ProviderKeys } from "@/lib/types";

const STORAGE_KEY = "parallel-research:keys-v1";
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const KEY_FORMATS: Record<Provider, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_\-]{20,}$/,
  openai: /^sk-[A-Za-z0-9_\-]{20,}$/,
  gemini: /^AIza[A-Za-z0-9_\-]{20,}$/,
  // Mistral key format is documented less rigidly; permissive long-string check.
  mistral: /^[A-Za-z0-9_\-]{24,}$/,
};

export function validateKeyFormat(provider: Provider, key: string): boolean {
  return KEY_FORMATS[provider].test(key.trim());
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptKeys(
  keys: ProviderKeys,
  passphrase: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext),
  );
  const blob = new Uint8Array(salt.length + iv.length + ciphertext.length);
  blob.set(salt, 0);
  blob.set(iv, salt.length);
  blob.set(ciphertext, salt.length + iv.length);
  return toBase64(blob);
}

export async function decryptKeys(
  encoded: string,
  passphrase: string,
): Promise<ProviderKeys> {
  const blob = fromBase64(encoded);
  const salt = blob.slice(0, SALT_BYTES);
  const iv = blob.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = blob.slice(SALT_BYTES + IV_BYTES);
  const cryptoKey = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext,
  );
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as ProviderKeys;
}

export function loadEncryptedBlob(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function saveEncryptedBlob(blob: string): void {
  window.localStorage.setItem(STORAGE_KEY, blob);
}

export function clearEncryptedBlob(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function hasStoredKeys(): boolean {
  return loadEncryptedBlob() !== null;
}
