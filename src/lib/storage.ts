import { clear, del, get, set, createStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

// All Aether data lives in this browser's IndexedDB. Nothing here is sent anywhere
// unless the user explicitly enables encrypted sync.
const store = typeof indexedDB !== 'undefined' ? createStore('aether', 'kv') : undefined;
const memory = new Map<string, string>();

export const idbStorage: StateStorage = {
  async getItem(name) {
    if (!store) return memory.get(name) ?? null;
    try {
      return (await get<string>(name, store)) ?? null;
    } catch {
      return memory.get(name) ?? null;
    }
  },
  async setItem(name, value) {
    memory.set(name, value);
    if (!store) return;
    try {
      await set(name, value, store);
    } catch {
      /* private mode / quota: keep the in-memory copy */
    }
  },
  async removeItem(name) {
    memory.delete(name);
    if (!store) return;
    try {
      await del(name, store);
    } catch {
      /* ignore */
    }
  },
};

export async function clearAllLocalData(): Promise<void> {
  memory.clear();
  if (store) await clear(store);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

export async function estimateStorage(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage, quota, persisted };
}
