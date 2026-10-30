import clsx from 'clsx';
import { ArrowLeftRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useActiveWorkspace, useMediaQuery } from '../../hooks.ts';
import { useBrowser } from '../../store/browser.ts';
import type { Tab } from '../../lib/types.ts';
import { isInternal, parseInternal } from '../../lib/util.ts';
import { Favicon, IconButton } from '../ui/index.tsx';
import { WebView } from './WebView.tsx';
import { NewTabPage } from '../pages/NewTabPage.tsx';
import { SearchPage } from '../pages/SearchPage.tsx';
import { PrivacyCenter } from '../pages/PrivacyCenter.tsx';
import { SettingsPage } from '../pages/SettingsPage.tsx';
import { HistoryPage } from '../pages/HistoryPage.tsx';
import { LibraryPage } from '../pages/LibraryPage.tsx';
import { AboutPage } from '../pages/AboutPage.tsx';

// Background tabs stay mounted (hidden) so live pages keep their state, like a real browser.
const KEEP_ALIVE = 6;

export function ContentArea() {
  const ws = useActiveWorkspace();
  const tabs = useBrowser((s) => s.tabs);
  const setSplit = useBrowser((s) => s.setSplit);
  const activateTab = useBrowser((s) => s.activateTab);
  const desktop = useMediaQuery('(min-width: 900px)');
  const [alive, setAlive] = useState<string[]>([]);
  const activeId = ws.activeTabId;
  const splitId = desktop ? ws.splitTabId : null;

  useEffect(() => {
    setAlive((prev) => {
      const ids = new Set(tabs.map((t) => t.id));
      const front = [activeId, splitId].filter((x): x is string => !!x);
      return [...front, ...prev.filter((id) => !front.includes(id))].filter((id) => ids.has(id)).slice(0, KEEP_ALIVE);
    });
  }, [activeId, splitId, tabs]);

  const rendered = alive.map((id) => tabs.find((t) => t.id === id)).filter((t): t is Tab => !!t);

  return (
    <div className="flex min-h-0 flex-1 gap-1.5 sm:gap-2">
      {rendered.map((tab) => {
        const isActive = tab.id === activeId;
        const isSplit = tab.id === splitId;
        const visible = isActive || isSplit;
        return (
          <section
            key={tab.id}
            aria-label={tab.title}
            hidden={!visible}
            className={clsx(
              'glass relative min-w-0 flex-1 flex-col overflow-hidden rounded-xl',
              visible ? 'flex' : 'hidden',
              isSplit && 'order-2',
              splitId && isActive && 'ring-1 ring-accent/30',
            )}
          >
            {splitId && visible && (
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2 text-[12px] text-fg-2">
                <Favicon url={tab.url} src={tab.favicon} className="size-3.5" />
                <span className="flex-1 truncate">{tab.title}</span>
                {isSplit && (
                  <IconButton
                    label="Focus this pane"
                    size="sm"
                    onClick={() => {
                      const prevActive = activeId;
                      activateTab(tab.id);
                      setSplit(ws.id, prevActive);
                    }}
                  >
                    <ArrowLeftRight className="size-3.5" />
                  </IconButton>
                )}
                <IconButton
                  label="Close split view"
                  size="sm"
                  onClick={() => {
                    if (isActive && splitId) activateTab(splitId);
                    setSplit(ws.id, null);
                  }}
                >
                  <X className="size-3.5" />
                </IconButton>
              </div>
            )}
            <TabView tab={tab} visible={visible} />
          </section>
        );
      })}
    </div>
  );
}

function TabView({ tab, visible }: { tab: Tab; visible: boolean }) {
  if (!isInternal(tab.url)) return <WebView tab={tab} visible={visible} />;
  const { page, params, hash } = parseInternal(tab.url);
  const body = (() => {
    switch (page) {
      case 'search':
        return <SearchPage tab={tab} query={params.get('q') ?? ''} />;
      case 'privacy':
        return <PrivacyCenter />;
      case 'settings':
        return <SettingsPage section={hash} />;
      case 'history':
        return <HistoryPage tab={tab} />;
      case 'library':
        return <LibraryPage tab={tab} hash={hash} />;
      case 'about':
        return <AboutPage />;
      default:
        return <NewTabPage tab={tab} />;
    }
  })();
  return <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{body}</div>;
}
