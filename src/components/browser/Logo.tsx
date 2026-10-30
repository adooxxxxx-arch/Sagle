export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aether-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9ccff" />
          <stop offset="1" stopColor="#3f7be0" />
        </linearGradient>
      </defs>
      <path d="M32 8 53 54H43.4L32 29 20.6 54H11Z" fill="url(#aether-logo)" />
      <path d="M23 44.5h18" stroke="var(--bg)" strokeWidth="4.5" />
    </svg>
  );
}
