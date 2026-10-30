// Decides whether a page's response headers allow it to be framed by Aether.

import type { EmbedInfo } from '../../../shared/api.ts';

/** Returns every `frame-ancestors` directive value found across CSP policies. */
export function parseFrameAncestors(csp: string | null | undefined): string[][] {
  if (!csp) return [];
  const out: string[][] = [];
  // Multiple CSP headers are joined with "," by the Fetch Headers API.
  for (const policy of csp.split(',')) {
    for (const directive of policy.split(';')) {
      const tokens = directive.trim().split(/\s+/).filter(Boolean);
      if (tokens.length && tokens[0]!.toLowerCase() === 'frame-ancestors') {
        out.push(tokens.slice(1).map((t) => t.toLowerCase()));
        break; // only the first occurrence in a policy counts
      }
    }
  }
  return out;
}

/**
 * A frame-ancestors source list allows an unknown third-party HTTPS origin
 * (Aether) only if it contains a wildcard: `*`, `https:`, or `https://*`.
 * `'none'`, `'self'` and specific host lists exclude Aether.
 */
export function frameAncestorsAllowsAether(sources: string[]): boolean {
  if (!sources.length) return false; // empty list == 'none'
  return sources.some((s) => s === '*' || s === 'https:' || s === 'https://*' || s === 'https://*:*');
}

export function analyzeEmbed(headers: Pick<Headers, 'get'>): EmbedInfo {
  const xfoRaw = headers.get('x-frame-options')?.trim() || undefined;
  const cspRaw = headers.get('content-security-policy') || undefined;
  const ancestors = parseFrameAncestors(cspRaw);
  const frameAncestors = ancestors.length ? ancestors.map((a) => a.join(' ') || "'none'").join(', ') : undefined;

  const base: EmbedInfo = { allowed: true, reason: '' };
  if (xfoRaw) base.xFrameOptions = xfoRaw;
  if (frameAncestors) base.frameAncestors = frameAncestors;

  // CSP frame-ancestors supersedes X-Frame-Options in modern browsers.
  if (ancestors.length) {
    const blocking = ancestors.find((list) => !frameAncestorsAllowsAether(list));
    if (blocking) {
      const desc = blocking.length === 0 || blocking.includes("'none'")
        ? "frame-ancestors 'none' forbids all framing"
        : blocking.every((s) => s === "'self'")
          ? "frame-ancestors 'self' only allows the site to frame itself"
          : `frame-ancestors only allows specific origins (${blocking.join(' ')})`;
      return { ...base, allowed: false, reason: `The site's Content-Security-Policy ${desc}.` };
    }
    return { ...base, allowed: true, reason: 'The Content-Security-Policy frame-ancestors directive allows any HTTPS origin.' };
  }

  if (xfoRaw) {
    const values = xfoRaw.toLowerCase().split(',').map((v) => v.trim());
    if (values.includes('deny')) {
      return { ...base, allowed: false, reason: 'The site sends X-Frame-Options: DENY, which forbids all framing.' };
    }
    if (values.includes('sameorigin')) {
      return { ...base, allowed: false, reason: 'The site sends X-Frame-Options: SAMEORIGIN, which only allows the site to frame itself.' };
    }
    return {
      ...base,
      allowed: true,
      reason: 'The X-Frame-Options value is not recognised by modern browsers (e.g. ALLOW-FROM) and is ignored.',
    };
  }

  return { ...base, allowed: true, reason: 'The site sends no framing restrictions (no X-Frame-Options or frame-ancestors).' };
}
