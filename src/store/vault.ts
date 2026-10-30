import { create } from 'zustand';
import { idbStorage } from '../lib/storage.ts';
import { open, seal, type Sealed } from '../lib/crypto.ts';

// The vault holds API keys, proxy passwords and the sync passphrase.
// Mode "device": stored in this browser's IndexedDB (never sent to Aether's server).
// Mode "encrypted": AES-GCM sealed with a passphrase; plaintext exists only in memory while unlocked.

const KEY = 'aether-vault';

type Persisted = { mode: 'device'; secrets: Record<string, string> } | { mode: 'encrypted'; sealed: Sealed };

interface VaultState {
  loaded: boolean;
  mode: 'device' | 'encrypted';
  locked: boolean;
  secrets: Record<string, string>;
  passphrase: string | null;
  load: () => Promise<void>;
  get: (k: string) => string | undefined;
  set: (k: string, v: string | null) => Promise<void>;
  enableEncryption: (passphrase: string) => Promise<void>;
  disableEncryption: () => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  wipe: () => Promise<void>;
}

async function persistVault(st: Pick<VaultState, 'mode' | 'secrets' | 'passphrase'>) {
  let value: Persisted;
  if (st.mode === 'encrypted') {
    if (!st.passphrase) throw new Error('Vault is locked');
    value = { mode: 'encrypted', sealed: await seal(JSON.stringify(st.secrets), st.passphrase) };
  } else {
    value = { mode: 'device', secrets: st.secrets };
  }
  await idbStorage.setItem(KEY, JSON.stringify(value));
}

export const useVault = create<VaultState>()((set, get) => ({
  loaded: false,
  mode: 'device',
  locked: false,
  secrets: {},
  passphrase: null,
  load: async () => {
    const raw = await idbStorage.getItem(KEY);
    if (!raw) return set({ loaded: true });
    try {
      const p = JSON.parse(raw as string) as Persisted;
      if (p.mode === 'encrypted') set({ loaded: true, mode: 'encrypted', locked: true, secrets: {} });
      else set({ loaded: true, mode: 'device', locked: false, secrets: p.secrets || {} });
    } catch {
      set({ loaded: true });
    }
  },
  get: (k) => get().secrets[k],
  set: async (k, v) => {
    if (get().locked) throw new Error('Unlock the vault first');
    const secrets = { ...get().secrets };
    if (v) secrets[k] = v;
    else delete secrets[k];
    set({ secrets });
    await persistVault({ ...get(), secrets });
  },
  enableEncryption: async (passphrase) => {
    set({ mode: 'encrypted', passphrase, locked: false });
    await persistVault(get());
  },
  disableEncryption: async () => {
    if (get().locked) throw new Error('Unlock the vault first');
    set({ mode: 'device', passphrase: null });
    await persistVault(get());
  },
  unlock: async (passphrase) => {
    const raw = await idbStorage.getItem(KEY);
    if (!raw) return false;
    const p = JSON.parse(raw as string) as Persisted;
    if (p.mode !== 'encrypted') return true;
    try {
      const secrets = JSON.parse(await open(p.sealed, passphrase)) as Record<string, string>;
      set({ secrets, passphrase, locked: false });
      return true;
    } catch {
      return false;
    }
  },
  lock: () => {
    if (get().mode === 'encrypted') set({ secrets: {}, passphrase: null, locked: true });
  },
  wipe: async () => {
    await idbStorage.removeItem(KEY);
    set({ mode: 'device', secrets: {}, passphrase: null, locked: false });
  },
}));
