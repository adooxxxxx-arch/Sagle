import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from '../lib/storage.ts';
import type { Bookmark, Collection, CollectionItem, DownloadRecord, Highlight, Note, ReadingItem } from '../lib/types.ts';
import { uid } from '../lib/util.ts';

interface LibraryState {
  bookmarks: Bookmark[];
  reading: ReadingItem[];
  notes: Note[];
  collections: Collection[];
  highlights: Highlight[];
  downloads: DownloadRecord[];

  toggleBookmark: (b: { url: string; title: string; favicon?: string }) => boolean;
  updateBookmark: (id: string, patch: Partial<Pick<Bookmark, 'title' | 'folder' | 'url'>>) => void;
  removeBookmark: (id: string) => void;

  addReading: (r: Omit<ReadingItem, 'id' | 'savedAt' | 'updatedAt' | 'read'>) => void;
  setRead: (id: string, read: boolean) => void;
  removeReading: (id: string) => void;

  createNote: (n?: Partial<Pick<Note, 'title' | 'body' | 'sourceUrl' | 'workspaceId'>>) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => void;
  appendToNote: (id: string, text: string) => void;
  removeNote: (id: string) => void;

  createCollection: (name: string) => string;
  renameCollection: (id: string, name: string) => void;
  removeCollection: (id: string) => void;
  addToCollection: (id: string, item: Omit<CollectionItem, 'id' | 'addedAt'>) => void;
  removeFromCollection: (id: string, itemId: string) => void;

  addHighlight: (h: Pick<Highlight, 'url' | 'quote'> & { note?: string }) => void;
  removeHighlight: (id: string) => void;

  addDownload: (d: DownloadRecord) => void;
  clearDownloads: () => void;

  replaceAll: (s: Partial<Pick<LibraryState, 'bookmarks' | 'reading' | 'notes' | 'collections' | 'highlights'>>) => void;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      bookmarks: [],
      reading: [],
      notes: [],
      collections: [],
      highlights: [],
      downloads: [],

      toggleBookmark: ({ url, title, favicon }) => {
        const existing = get().bookmarks.find((b) => b.url === url);
        if (existing) {
          set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== existing.id) }));
          return false;
        }
        const now = Date.now();
        set((s) => ({ bookmarks: [{ id: uid(), url, title, favicon, folder: 'Bookmarks', createdAt: now, updatedAt: now }, ...s.bookmarks] }));
        return true;
      },
      updateBookmark: (id, patch) =>
        set((s) => ({ bookmarks: s.bookmarks.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)) })),
      removeBookmark: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),

      addReading: (r) =>
        set((s) => {
          const now = Date.now();
          const rest = s.reading.filter((x) => x.url !== r.url);
          return { reading: [{ ...r, id: uid(), read: false, savedAt: now, updatedAt: now }, ...rest] };
        }),
      setRead: (id, read) => set((s) => ({ reading: s.reading.map((r) => (r.id === id ? { ...r, read, updatedAt: Date.now() } : r)) })),
      removeReading: (id) => set((s) => ({ reading: s.reading.filter((r) => r.id !== id) })),

      createNote: (n = {}) => {
        const now = Date.now();
        const note: Note = {
          id: uid(),
          title: n.title ?? 'Untitled note',
          body: n.body ?? '',
          sourceUrl: n.sourceUrl,
          workspaceId: n.workspaceId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ notes: [note, ...s.notes] }));
        return note.id;
      },
      updateNote: (id, patch) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)) })),
      appendToNote: (id, text) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, body: (n.body ? n.body + '\n\n' : '') + text, updatedAt: Date.now() } : n)),
        })),
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      createCollection: (name) => {
        const now = Date.now();
        const c: Collection = { id: uid(), name, items: [], createdAt: now, updatedAt: now };
        set((s) => ({ collections: [c, ...s.collections] }));
        return c.id;
      },
      renameCollection: (id, name) =>
        set((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, name, updatedAt: Date.now() } : c)) })),
      removeCollection: (id) => set((s) => ({ collections: s.collections.filter((c) => c.id !== id) })),
      addToCollection: (id, item) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === id
              ? {
                  ...c,
                  items: [{ ...item, id: uid(), addedAt: Date.now() }, ...c.items.filter((i) => i.url !== item.url)],
                  updatedAt: Date.now(),
                }
              : c,
          ),
        })),
      removeFromCollection: (id, itemId) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === id ? { ...c, items: c.items.filter((i) => i.id !== itemId), updatedAt: Date.now() } : c,
          ),
        })),

      addHighlight: ({ url, quote, note }) =>
        set((s) => {
          const now = Date.now();
          return { highlights: [{ id: uid(), url, quote, note, createdAt: now, updatedAt: now }, ...s.highlights] };
        }),
      removeHighlight: (id) => set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) })),

      addDownload: (d) => set((s) => ({ downloads: [d, ...s.downloads].slice(0, 200) })),
      clearDownloads: () => set({ downloads: [] }),

      replaceAll: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    { name: 'aether-library', version: 1, storage: createJSONStorage(() => idbStorage) },
  ),
);
