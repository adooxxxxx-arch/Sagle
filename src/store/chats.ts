import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from '../lib/storage.ts';
import type { Chat, ChatMessage } from '../lib/types.ts';
import { uid } from '../lib/util.ts';
import { useBrowser } from './browser.ts';

interface ChatState {
  chats: Chat[];
  activeChat: Record<string, string | null>;
  newChat: (workspaceId: string) => string;
  setActive: (workspaceId: string, chatId: string | null) => void;
  addMessage: (chatId: string, m: ChatMessage) => void;
  patchMessage: (chatId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  appendDelta: (chatId: string, messageId: string, delta: string) => void;
  renameChat: (chatId: string, title: string) => void;
  deleteChat: (chatId: string) => void;
  clearChats: (workspaceId?: string) => void;
}

export const useChats = create<ChatState>()(
  persist(
    (set) => ({
      chats: [],
      activeChat: {},
      newChat: (workspaceId) => {
        const now = Date.now();
        const chat: Chat = { id: uid(), workspaceId, title: 'New conversation', messages: [], createdAt: now, updatedAt: now };
        set((s) => ({ chats: [chat, ...s.chats], activeChat: { ...s.activeChat, [workspaceId]: chat.id } }));
        return chat.id;
      },
      setActive: (workspaceId, chatId) => set((s) => ({ activeChat: { ...s.activeChat, [workspaceId]: chatId } })),
      addMessage: (chatId, m) =>
        set((s) => ({
          chats: s.chats.map((c) => {
            if (c.id !== chatId) return c;
            const title = c.messages.length === 0 && m.role === 'user' ? m.content.slice(0, 60) : c.title;
            return { ...c, title, messages: [...c.messages, m], updatedAt: Date.now() };
          }),
        })),
      patchMessage: (chatId, messageId, patch) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) } : c,
          ),
        })),
      appendDelta: (chatId, messageId, delta) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + delta } : m)) }
              : c,
          ),
        })),
      renameChat: (chatId, title) => set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)) })),
      deleteChat: (chatId) => set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId) })),
      clearChats: (workspaceId) =>
        set((s) => ({ chats: workspaceId ? s.chats.filter((c) => c.workspaceId !== workspaceId) : [], activeChat: {} })),
    }),
    {
      name: 'aether-chats',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => {
        const ephemeral = new Set(useBrowser.getState().workspaces.filter((w) => w.ephemeral).map((w) => w.id));
        return {
          chats: s.chats
            .filter((c) => !ephemeral.has(c.workspaceId))
            .map((c) => ({ ...c, messages: c.messages.map((m) => (m.pending ? { ...m, pending: false } : m)) })),
          activeChat: Object.fromEntries(Object.entries(s.activeChat).filter(([k]) => !ephemeral.has(k))),
        };
      },
    },
  ),
);
