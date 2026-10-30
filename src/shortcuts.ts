import { useEffect } from 'react';
import { useBrowser } from './store/browser.ts';
import { useLibrary } from './store/library.ts';
import { useSettings } from './store/settings.ts';
import { useUi } from './store/ui.ts';
import { isInternal } from './lib/util.ts';

// Browsers reserve Ctrl/⌘+T, W, N, L and Tab for themselves and a web page cannot override
// them, so Aether's tab shortcuts use Alt/⌥ (matched on `event.code` so macOS ⌥ works).
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Mod+K', action: 'Command palette' },
  { keys: 'Alt+T', action: 'New tab' },
  { keys: 'Alt+W', action: 'Close tab' },
  { keys: 'Alt+Shift+T', action: 'Reopen closed tab' },
  { keys: 'Alt+L', action: 'Focus address bar' },
  { keys: 'Alt+R', action: 'Reload' },
  { keys: 'Alt+[', action: 'Back' },
  { keys: 'Alt+]', action: 'Forward' },
  { keys: 'Alt+1…9', action: 'Switch to tab 1…9' },
  { keys: 'Alt+M', action: 'Toggle Reader / Live view' },
  { keys: 'Alt+D', action: 'Bookmark page' },
  { keys: 'Alt+A', action: 'Toggle AI assistant' },
  { keys: 'Alt+S', action: 'Toggle sidebar' },
  { keys: 'Alt+P', action: 'Privacy center' },
];

function activeTab() {
  const s = useBrowser.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  return s.tabs.find((t) => t.id === ws?.activeTabId) ?? null;
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const b = useBrowser.getState();
      const ui = useUi.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }
      if (!e.altKey || mod) return;
      const tab = activeTab();
      const code = e.code;
      let handled = true;
      if (code === 'KeyT' && e.shiftKey) b.reopenClosed();
      else if (code === 'KeyT') {
        b.newTab();
        ui.focusAddress();
      } else if (code === 'KeyW' && tab) b.closeTab(tab.id);
      else if (code === 'KeyL') ui.focusAddress();
      else if (code === 'KeyR' && tab) b.reload(tab.id);
      else if (code === 'BracketLeft' && tab) b.back(tab.id);
      else if (code === 'BracketRight' && tab) b.forward(tab.id);
      else if (/^Digit[1-9]$/.test(code)) {
        const tabs = b.tabs.filter((t) => t.workspaceId === b.activeWorkspaceId);
        const n = Number(code.slice(5));
        const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
        if (target) b.activateTab(target.id);
      } else if (code === 'KeyM' && tab && !isInternal(tab.url)) b.setViewMode(tab.id, tab.viewMode === 'reader' ? 'live' : 'reader');
      else if (code === 'KeyD' && tab && !isInternal(tab.url)) {
        const added = useLibrary.getState().toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon });
        ui.toast(added ? 'Bookmarked' : 'Bookmark removed', 'ok');
      } else if (code === 'KeyA') useSettings.getState().update((s) => void (s.aiPanelOpen = !s.aiPanelOpen));
      else if (code === 'KeyS') {
        if (window.innerWidth < 768) ui.setMobileSidebar(!ui.mobileSidebarOpen);
        else useSettings.getState().update((s) => void (s.sidebarCollapsed = !s.sidebarCollapsed));
      } else if (code === 'KeyP' && tab) b.newTab('aether://privacy');
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function formatKeys(keys: string, mac: boolean): string {
  return keys
    .replace('Mod', mac ? '⌘' : 'Ctrl')
    .replace('Alt', mac ? '⌥' : 'Alt')
    .replace('Shift', mac ? '⇧' : 'Shift');
}
