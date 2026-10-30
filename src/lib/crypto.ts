// WebCrypto helpers for the local vault and end-to-end-encrypted sync.
// PBKDF2-SHA256 (310k iterations) → AES-256-GCM. Keys never leave the browser.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 310_000;

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

export function base64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface Sealed {
  ciphertext: string;
  iv: string;
  salt: string;
}

export async function seal(plaintext: string, passphrase: string, salt = randomBytes(16)): Promise<Sealed> {
  const key = await deriveKey(passphrase, salt);
  return sealWithKey(plaintext, key, salt);
}

export async function sealWithKey(plaintext: string, key: CryptoKey, salt: Uint8Array): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: toB64(ct), iv: toB64(iv), salt: toB64(salt) };
}

export async function open(sealed: Sealed, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromB64(sealed.salt));
  return openWithKey(sealed, key);
}

export async function openWithKey(sealed: Sealed, key: CryptoKey): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ciphertext));
  return dec.decode(pt);
}
