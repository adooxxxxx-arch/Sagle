// Storage for end-to-end-encrypted sync envelopes.
// On Netlify: Netlify Blobs store "aether-sync". Elsewhere (local dev, tests):
// an in-memory Map, so the feature works without a Blobs environment.

import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { SYNC_MAX_BYTES, type SyncEnvelope } from '../../../shared/api.ts';
import { ApiErr, isRecord } from './http.ts';

export interface SyncStore {
  readonly kind: 'blobs' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

class MemoryStore implements SyncStore {
  readonly kind = 'memory' as const;
  private readonly map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

type BlobStore = ReturnType<typeof getStore>;

class BlobsStore implements SyncStore {
  readonly kind = 'blobs' as const;
  constructor(private readonly store: BlobStore) {}
  async get(key: string) {
    try {
      return await this.store.get(key, { type: 'text', consistency: 'strong' });
    } catch (err) {
      // Strong consistency needs the uncached edge URL; fall back if absent.
      if (err instanceof Error && err.name === 'BlobsConsistencyError') return this.store.get(key, { type: 'text' });
      throw err;
    }
  }
  async set(key: string, value: string) {
    await this.store.set(key, value);
  }
  async delete(key: string) {
    await this.store.delete(key);
  }
}

let cached: SyncStore | undefined;
const memory = new MemoryStore();

export function getSyncStore(): SyncStore {
  if (cached) return cached;
  try {
    cached = new BlobsStore(getStore({ name: 'aether-sync' }));
  } catch (err) {
    if (err instanceof Error && err.name === 'MissingBlobsEnvironmentError') cached = memory;
    else throw err;
  }
  return cached;
}

/** For tests: forget the detected store. */
export function __resetSyncStore(): void {
  cached = undefined;
}

/** The server never stores the raw sync id: keys are SHA-256(id) in hex. */
export function syncKey(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex');
}

const B64 = /^[A-Za-z0-9+/_-]*={0,2}$/;

export function validateEnvelope(data: unknown): SyncEnvelope {
  if (!isRecord(data)) throw new ApiErr('BAD_REQUEST', 'Sync payload must be a JSON object.', 400);
  const { v, ciphertext, iv, salt, updatedAt } = data;
  if (v !== 1) throw new ApiErr('BAD_REQUEST', 'Unsupported sync envelope version.', 400);
  if (typeof ciphertext !== 'string' || !ciphertext || !B64.test(ciphertext)) {
    throw new ApiErr('BAD_REQUEST', 'ciphertext must be a base64 string.', 400);
  }
  if (typeof iv !== 'string' || !iv || iv.length > 64 || !B64.test(iv)) {
    throw new ApiErr('BAD_REQUEST', 'iv must be a short base64 string.', 400);
  }
  if (typeof salt !== 'string' || !salt || salt.length > 128 || !B64.test(salt)) {
    throw new ApiErr('BAD_REQUEST', 'salt must be a short base64 string.', 400);
  }
  if (typeof updatedAt !== 'string' || updatedAt.length > 40 || Number.isNaN(Date.parse(updatedAt))) {
    throw new ApiErr('BAD_REQUEST', 'updatedAt must be an ISO date string.', 400);
  }
  const env: SyncEnvelope = { v: 1, ciphertext, iv, salt, updatedAt };
  if (Buffer.byteLength(JSON.stringify(env)) > SYNC_MAX_BYTES) {
    throw new ApiErr('TOO_LARGE', 'Sync payload is too large.', 413);
  }
  return env;
}
