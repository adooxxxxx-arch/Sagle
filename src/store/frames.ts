import { create } from 'zustand';

// Runtime state of live (iframe) views, so the toolbar can show loading/stop for them.
interface FramesState {
  loading: Record<string, boolean>;
  stopped: Record<string, number>;
  setLoading: (tabId: string, v: boolean) => void;
  stop: (tabId: string) => void;
}

export const useFrames = create<FramesState>()((set) => ({
  loading: {},
  stopped: {},
  setLoading: (tabId, v) => set((s) => ({ loading: { ...s.loading, [tabId]: v } })),
  stop: (tabId) => set((s) => ({ stopped: { ...s.stopped, [tabId]: Date.now() }, loading: { ...s.loading, [tabId]: false } })),
}));
