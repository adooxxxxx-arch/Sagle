import clsx from 'clsx';
import { useApplyTheme, useHydration, useMediaQuery } from './hooks.ts';
import { useGlobalShortcuts } from './shortcuts.ts';
import { useSettings } from './store/settings.ts';
import { useUi } from './store/ui.ts';
import { Sidebar } from './components/browser/Sidebar.tsx';
import { Toolbar } from './components/browser/Toolbar.tsx';
import { ContentArea } from './components/browser/ContentArea.tsx';
import { AiPanel } from './components/ai/AiPanel.tsx';
import { CommandPalette } from './components/browser/CommandPalette.tsx';
import { ConfirmDialog, Toasts } from './components/browser/Overlays.tsx';
import { Logo } from './components/browser/Logo.tsx';

export function App() {
  useApplyTheme();
  const ready = useHydration();
  if (!ready) {
    return (
      <>
        <div className="aether-backdrop" />
        <div className="relative z-10 flex h-dvh items-center justify-center anim-fade">
          <Logo className="size-9 opacity-80" />
        </div>
      </>
    );
  }
  return <Shell />;
}

function Shell() {
  useGlobalShortcuts();
  const collapsed = useSettings((s) => s.settings.sidebarCollapsed);
  const aiOpen = useSettings((s) => s.settings.aiPanelOpen);
  const mobileSidebar = useUi((s) => s.mobileSidebarOpen);
  const setMobileSidebar = useUi((s) => s.setMobileSidebar);
  const desktop = useMediaQuery('(min-width: 768px)');
  const wide = useMediaQuery('(min-width: 1180px)');

  return (
    <>
      <div className="aether-backdrop" />
      <div className="relative z-10 flex h-dvh gap-2 p-1.5 sm:p-2">
        {desktop && !collapsed && <Sidebar />}
        {!desktop && mobileSidebar && (
          <div className="fixed inset-0 z-50 flex anim-fade">
            <div className="absolute inset-0 bg-black/35" onClick={() => setMobileSidebar(false)} />
            <div className="relative h-full p-1.5 anim-slide">
              <Sidebar mobile />
            </div>
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col gap-1.5 sm:gap-2">
          <Toolbar />
          <ContentArea />
        </main>
        {aiOpen && (
          <div
            className={clsx(
              wide ? 'relative w-[380px] shrink-0' : 'fixed inset-y-0 right-0 z-40 w-full max-w-[420px] p-1.5 sm:p-2 anim-fade',
            )}
          >
            <AiPanel />
          </div>
        )}
      </div>
      <CommandPalette />
      <ConfirmDialog />
      <Toasts />
    </>
  );
}
