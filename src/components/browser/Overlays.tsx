import clsx from 'clsx';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Button, IconButton, Modal } from '../ui/index.tsx';
import { useUi } from '../../store/ui.ts';

export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);
  return (
    <Modal
      open={!!confirm}
      onClose={() => close(false)}
      title={confirm?.title ?? ''}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
            {confirm?.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg-2">{confirm?.body}</p>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-[110] flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="glass-strong pointer-events-auto flex items-center gap-2.5 rounded-lg px-3 py-2 anim-rise">
          {t.tone === 'ok' ? (
            <CheckCircle2 className="size-4 text-ok shrink-0" />
          ) : t.tone === 'error' ? (
            <XCircle className="size-4 text-danger shrink-0" />
          ) : (
            <Info className="size-4 text-accent shrink-0" />
          )}
          <span className={clsx('flex-1 text-[12.5px]')}>{t.message}</span>
          {t.action && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </Button>
          )}
          <IconButton label="Dismiss" size="sm" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
