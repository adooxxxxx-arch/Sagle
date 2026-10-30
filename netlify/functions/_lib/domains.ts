// Registrable-domain (eTLD+1) heuristic and third-party detection.
// Not a full Public Suffix List: it covers generic ccTLD second levels
// (co.uk, com.au, ac.jp, ...) plus common multi-part and hosting suffixes.

import { ipVersion } from './ip.ts';

/** Explicit multi-label public suffixes (incl. "private" hosting suffixes from the PSL). */
const MULTI_PART_SUFFIXES = new Set([
  // ccTLD second levels that don't follow the generic pattern below
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'police.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz',
  'co.za', 'org.za', 'gov.za', 'ac.za', 'web.za',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'blog.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'gov.in', 'edu.in', 'nic.in', 'res.in',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx',
  'com.ar', 'org.ar', 'gob.ar', 'net.ar', 'edu.ar',
  'com.sg', 'org.sg', 'edu.sg', 'gov.sg', 'net.sg',
  'com.my', 'org.my', 'net.my', 'gov.my', 'edu.my',
  'co.id', 'or.id', 'ac.id', 'go.id', 'web.id', 'my.id',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr', 'edu.tr', 'gen.tr',
  'com.ua', 'org.ua', 'net.ua', 'gov.ua', 'in.ua', 'kiev.ua',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'muni.il',
  'com.pl', 'net.pl', 'org.pl', 'waw.pl',
  'co.th', 'or.th', 'in.th', 'go.th', 'ac.th',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
  'com.pk', 'net.pk', 'org.pk', 'edu.pk', 'gov.pk',
  'com.eg', 'com.sa', 'com.ng', 'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo',
  'co.ke', 'co.tz', 'co.ug', 'co.zw', 'co.ve', 'co.cr',
  // Hosting / platform suffixes (each customer subdomain is its own site)
  'github.io', 'gitlab.io', 'netlify.app', 'netlify.com', 'vercel.app', 'now.sh', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'herokussl.com', 'web.app', 'firebaseapp.com', 'appspot.com', 'blogspot.com',
  'cloudfront.net', 'azurewebsites.net', 'azureedge.net', 'azurestaticapps.net', 'trafficmanager.net',
  'fly.dev', 'onrender.com', 'glitch.me', 'repl.co', 'replit.app', 'surge.sh', 'ngrok.io', 'ngrok-free.app',
  'myshopify.com', 'wixsite.com', 'wordpress.com', 'tumblr.com', 'neocities.org', 'readthedocs.io',
  'gitbook.io', 'webflow.io', 'framer.app', 'deno.dev', 'railway.app', 'up.railway.app', 'translate.goog',
  's3.amazonaws.com', 'elasticbeanstalk.com', 'amplifyapp.com', 'fastly.net', 'global.ssl.fastly.net',
  'dyndns.org', 'duckdns.org', 'no-ip.org', 'ddns.net',
]);

/** Generic second-level labels used under many two-letter ccTLDs. */
const GENERIC_SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil', 'nic', 'ltd', 'plc', 'sch', 'nom']);

export function publicSuffixLength(labels: string[]): number {
  const n = labels.length;
  // Longest explicit match first (up to 4 labels, e.g. global.ssl.fastly.net).
  for (let k = Math.min(4, n - 1); k >= 2; k--) {
    if (MULTI_PART_SUFFIXES.has(labels.slice(n - k).join('.'))) return k;
  }
  if (n >= 3 && labels[n - 1]!.length === 2 && GENERIC_SLD.has(labels[n - 2]!)) return 2;
  return 1;
}

/** Returns the registrable domain (eTLD+1) of a host name; IPs are returned unchanged. */
export function registrableDomain(host: string): string {
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  if (!h || ipVersion(h)) return h;
  const labels = h.split('.');
  if (labels.length <= 1) return h;
  const suffix = publicSuffixLength(labels);
  if (labels.length <= suffix) return h;
  return labels.slice(-(suffix + 1)).join('.');
}

export function isThirdParty(host: string, pageHost: string): boolean {
  return registrableDomain(host) !== registrableDomain(pageHost);
}
