import { BookOpenText, MonitorPlay, ShieldCheck, Sparkles } from 'lucide-react';
import { Logo } from '../browser/Logo.tsx';

export function AboutPage() {
  const modes = [
    { icon: <MonitorPlay />, t: 'Live view', d: 'The real site, embedded in a sandboxed frame. Works when the site allows embedding. Its scripts and cookies run in your browser.' },
    { icon: <BookOpenText />, t: 'Reader view', d: 'Aether’s server fetches the page without your cookies or IP, strips scripts and trackers, and shows clean text. Works on most article-style pages.' },
    { icon: <ShieldCheck />, t: 'New browser tab', d: 'For sites that block embedding and aren’t readable (web apps, logins, banking), Aether opens them in a normal tab of your browser.' },
    { icon: <Sparkles />, t: 'AI assistant', d: 'Reads only the context you choose (page, selection, tabs, workspace or nothing) and cites its sources.' },
  ];
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="flex items-center gap-3">
        <Logo className="size-9" />
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Aether</h1>
          <p className="text-[12.5px] text-fg-2">A private, AI-native browser that runs from a link.</p>
        </div>
      </div>
      <p className="mt-6 text-[13px] leading-relaxed text-fg-2">
        Aether is a web app, not a browser engine. It can’t do everything a native browser does, so it shows you which of these modes each
        page is using:
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {modes.map((m) => (
          <div key={m.t} className="glass rounded-xl p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium [&>svg]:size-4 [&>svg]:text-accent">
              {m.icon}
              {m.t}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-fg-2">{m.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-fg-3">
        Remote browser sessions (streaming a server-side browser for sites that block embedding) aren’t available in this deployment. They
        need dedicated browser infrastructure.
      </p>
    </div>
  );
}
