import { Camera, ClipboardCopy, Code2, Expand, FormInput, MapPin, Mic, PanelTop } from 'lucide-react';
import type { ReactNode } from 'react';
import { permissionsFor, useSettings } from '../../store/settings.ts';
import type { SitePermissions } from '../../lib/types.ts';
import { Button, Modal, Toggle } from '../ui/index.tsx';

export const PERMISSION_LABELS: { key: keyof SitePermissions; label: string; icon: ReactNode; hint: string }[] = [
  { key: 'javascript', label: 'JavaScript', icon: <Code2 />, hint: 'Live view only. Off = sandboxed without scripts.' },
  { key: 'popups', label: 'Pop-ups & new windows', icon: <PanelTop />, hint: 'Lets the site open links in new browser tabs.' },
  { key: 'forms', label: 'Form submission', icon: <FormInput />, hint: 'Needed to log in or search on the site.' },
  { key: 'camera', label: 'Camera', icon: <Camera />, hint: 'Delegated to the embedded site; your browser still asks too.' },
  { key: 'microphone', label: 'Microphone', icon: <Mic />, hint: 'Delegated to the embedded site; your browser still asks too.' },
  { key: 'geolocation', label: 'Location', icon: <MapPin />, hint: 'Delegated to the embedded site; your browser still asks too.' },
  { key: 'fullscreen', label: 'Fullscreen', icon: <Expand />, hint: 'Video players and presentations.' },
  { key: 'clipboard', label: 'Clipboard write', icon: <ClipboardCopy />, hint: '“Copy” buttons on the site.' },
];

export function SitePermissionsDialog({ host, onClose }: { host: string; onClose: () => void }) {
  useSettings((s) => s.sitePermissions[host]);
  const set = useSettings((s) => s.setSitePermission);
  const reset = useSettings((s) => s.resetSitePermissions);
  const perms = permissionsFor(host);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Permissions for ${host}`}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => reset(host)}>
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-fg-3">
        These apply to Live view, through the embedded frame’s sandbox and permission policy. Changes take effect on the next reload.
        Reader view never runs site scripts.
      </p>
      <div className="flex flex-col">
        {PERMISSION_LABELS.map((p) => (
          <label key={p.key} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <span className="flex size-7 items-center justify-center rounded-md bg-surface-2 text-fg-2 [&>svg]:size-4">{p.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{p.label}</span>
              <span className="block text-[11.5px] text-fg-3">{p.hint}</span>
            </span>
            <Toggle checked={perms[p.key]} onChange={(v) => set(host, { [p.key]: v })} label={p.label} />
          </label>
        ))}
      </div>
    </Modal>
  );
}
