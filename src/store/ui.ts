import { create } from 'zustand';
import { uid } from '../lib/util.ts';

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'ok' | 'error';
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  paletteOpen: boolean;
  mobileSidebarOpen: boolean;
  addressFocusNonce: number;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  /** Text the user selected in a reader view (only readable for Aether-rendered content). */
  selection: { text: string; url: string; at: number } | null;
  /** Pending prompt pushed into the AI panel by contextual actions. */
  aiRequest: { prompt: string; context: 'page' | 'selection' | 'tabs' | 'none'; research?: boolean; collectionId?: string; nonce: number } | null;
  /** Session-scoped consent for sending private-workspace content to cloud AI. */
  privateAiConsent: Record<string, boolean>;
  setPalette: (open: boolean) => void;
  setMobileSidebar: (open: boolean) => void;
  focusAddress: () => void;
  toast: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismissToast: (id: string) => void;
  ask: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
  setSelection: (s: UiState['selection']) => void;
  requestAi: (r: Omit<NonNullable<UiState['aiRequest']>, 'nonce'>) => void;
  grantPrivateAi: (workspaceId: string) => void;
}

export const useUi = create<UiState>()((set, get) => ({
  paletteOpen: false,
  mobileSidebarOpen: false,
  addressFocusNonce: 0,
  toasts: [],
  confirm: null,
  selection: null,
  aiRequest: null,
  privateAiConsent: {},
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  focusAddress: () => set((s) => ({ addressFocusNonce: s.addressFocusNonce + 1 })),
  toast: (message, tone = 'info', action) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      get().confirm?.resolve(false);
      set({ confirm: { ...req, resolve } });
    }),
  closeConfirm: (ok) => {
    get().confirm?.resolve(ok);
    set({ confirm: null });
  },
  setSelection: (selection) => set({ selection }),
  requestAi: (r) => set((s) => ({ aiRequest: { ...r, nonce: (s.aiRequest?.nonce ?? 0) + 1 } })),
  grantPrivateAi: (workspaceId) => set((s) => ({ privateAiConsent: { ...s.privateAiConsent, [workspaceId]: true } })),
}));
