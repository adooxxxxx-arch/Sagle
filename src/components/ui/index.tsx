import clsx from 'clsx';
import { Globe } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Variant = 'ghost' | 'subtle' | 'primary' | 'danger' | 'outline';

const variants: Record<Variant, string> = {
  ghost: 'text-fg-2 hover:text-fg hover:bg-hover active:bg-active',
  subtle: 'bg-surface-2 text-fg hover:bg-active border border-line',
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 font-medium',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/25',
  outline: 'border border-line-strong text-fg hover:bg-hover',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'subtle', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-[background,color,filter] duration-150 disabled:opacity-40 disabled:pointer-events-none select-none',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

/** Square icon button. `label` is required: it becomes the aria-label and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = 'md', className, children, type = 'button', tooltipSide = 'bottom', ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={clsx(
          'inline-flex items-center justify-center rounded-md shrink-0 transition-colors duration-150 disabled:opacity-35 disabled:pointer-events-none',
          size === 'sm' ? 'size-7' : 'size-8',
          active ? 'bg-active text-fg' : 'text-fg-2 hover:text-fg hover:bg-hover active:bg-active',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = wrap.current?.firstElementChild as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = side === 'left' ? r.left - 8 : side === 'right' ? r.right + 8 : r.left + r.width / 2;
      const y = side === 'top' ? r.top - 8 : side === 'bottom' ? r.bottom + 8 : r.top + r.height / 2;
      setPos({ x, y });
    }, 450);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : side === 'left'
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)';

  return (
    <span ref={wrap} className="contents" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} onFocus={show} onBlur={hide}>
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="glass-strong pointer-events-none fixed z-[100] flex items-center gap-2 rounded-md px-2 py-1 text-[11.5px] text-fg anim-fade whitespace-nowrap"
            style={{ left: pos.x, top: pos.y, transform }}
          >
            {content}
            {shortcut && <kbd>{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </span>
  );
}

export function Favicon({ url, src, className }: { url: string; src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const candidate = src || (() => {
    try {
      const u = new URL(url);
      return u.protocol.startsWith('http') ? `${u.origin}/favicon.ico` : undefined;
    } catch {
      return undefined;
    }
  })();
  useEffect(() => setFailed(false), [candidate]);
  if (!candidate || failed) return <Globe className={clsx('size-4 text-fg-3 shrink-0', className)} strokeWidth={1.75} />;
  return (
    <img
      src={candidate}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      className={clsx('size-4 rounded-[3px] shrink-0 object-contain', className)}
      onError={() => setFailed(true)}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent border-transparent' : 'bg-surface-2 border-line-strong',
      )}
    >
      <span
        className={clsx(
          'inline-block size-3.5 rounded-full shadow-sm transition-transform duration-200 ease-out-soft',
          checked ? 'translate-x-[15px] bg-accent-fg' : 'translate-x-[1px] bg-fg-2',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-[5px] transition-colors duration-150 disabled:opacity-35',
            size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
            value === o.value ? 'bg-active text-fg shadow-sm' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={clsx(
        'h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg outline-none hover:bg-hover',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[var(--page)] text-fg">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-3 outline-none transition-colors focus:border-accent/60 focus:bg-surface-2',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-fg-3 leading-relaxed">{hint}</p>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>('input,textarea,button');
      target?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh] anim-fade">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-strong relative w-full rounded-xl anim-rise flex flex-col max-h-[76vh]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="px-4 pb-4 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  separator?: boolean;
}

/** Positioned context/dropdown menu with keyboard navigation. */
export function Menu({
  anchor,
  items,
  onClose,
}: {
  anchor: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - r.height - 8)),
    });
  }, [anchor]);
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[next]?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [anchor, onClose]);
  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="glass-strong fixed z-[95] min-w-[200px] rounded-lg p-1 anim-fade"
      style={{ left: (pos ?? anchor).x, top: (pos ?? anchor).y }}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
            className={clsx(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] outline-none disabled:opacity-35',
              it.danger ? 'text-danger hover:bg-danger/10 focus:bg-danger/10' : 'text-fg hover:bg-hover focus:bg-hover',
            )}
          >
            <span className="flex size-4 items-center justify-center text-fg-2 [&>svg]:size-[15px]">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg-2 [&>svg]:size-5">
        {icon}
      </div>
      <p className="text-[13.5px] font-medium">{title}</p>
      {body && <p className="max-w-sm text-[12.5px] text-fg-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-surface-2 text-fg-2 border-line',
    ok: 'bg-ok/12 text-ok border-ok/25',
    warn: 'bg-warn/12 text-warn border-warn/25',
    danger: 'bg-danger/12 text-danger border-danger/25',
    accent: 'bg-accent-soft text-accent border-accent/25',
  };
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-px text-[11px] font-medium whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass rounded-xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] text-fg-3 max-w-2xl leading-relaxed">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Row({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{title}</div>
        {description && <div className="mt-0.5 text-[12px] text-fg-3 leading-relaxed">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
