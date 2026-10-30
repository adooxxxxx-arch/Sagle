// IP address parsing and private/reserved range classification (SSRF guard).

/** Parses a strict dotted-quad IPv4 address into a 32-bit unsigned integer. */
export function parseIPv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** Parses an IPv6 address (brackets / zone id tolerated) into eight 16-bit groups. */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(':')) return null;

  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (v4 === null) return null;
    tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    // Keep everything up to the last colon; "::" stays, a single trailing ":" goes.
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith('::')) s = s.slice(0, -1);
  }

  const dbl = s.indexOf('::');
  if (dbl !== -1 && s.indexOf('::', dbl + 1) !== -1) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const needed = 8 - tail.length;
  let groups: number[];
  if (dbl !== -1) {
    const head = parseGroups(s.slice(0, dbl));
    const rest = parseGroups(s.slice(dbl + 2));
    if (!head || !rest) return null;
    const fill = needed - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    const all = parseGroups(s);
    if (!all || all.length !== needed) return null;
    groups = all;
  }
  return [...groups, ...tail];
}

export function ipVersion(s: string): 0 | 4 | 6 {
  if (parseIPv4(s) !== null) return 4;
  if (parseIPv6(s) !== null) return 6;
  return 0;
}

function v4InCidr(ip: number, base: string, bits: number): boolean {
  const b = parseIPv4(base)!;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (b & mask) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local / cloud metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast (255.255.255.255)
];

export function isPrivateIPv4Int(ip: number): boolean {
  return PRIVATE_V4.some(([base, bits]) => v4InCidr(ip, base, bits));
}

function groupsToV4(hi: number, lo: number): number {
  return ((hi << 16) | lo) >>> 0;
}

export function isPrivateIPv6Groups(g: number[]): boolean {
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // :: and ::1
  if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d
  if (allZero(0, 5) && g[5] === 0xffff) return isPrivateIPv4Int(groupsToV4(g[6]!, g[7]!));
  // IPv4-translated ::ffff:0:a.b.c.d (RFC 2765)
  if (allZero(0, 4) && g[4] === 0xffff && g[5] === 0) return isPrivateIPv4Int(groupsToV4(g[6]!, g[7]!));
  // Deprecated IPv4-compatible ::a.b.c.d
  if (allZero(0, 6)) return isPrivateIPv4Int(groupsToV4(g[6]!, g[7]!));
  // NAT64 well-known prefix 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isPrivateIPv4Int(groupsToV4(g[6]!, g[7]!));
  // NAT64 local-use 64:ff9b:1::/48
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // Discard-only 100::/64
  if (g[0] === 0x100 && allZero(1, 4)) return true;
  // Teredo 2001::/32 (tunnels to arbitrary v4) and ORCHID/benchmarking 2001:0002::/48, 2001:10::/28
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 2 || (g[1]! & 0xfff0) === 0x10)) return true;
  // Documentation 2001:db8::/32
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  // 6to4 2002::/16 embeds an IPv4 address in groups 1-2
  if (g[0] === 0x2002) return isPrivateIPv4Int(groupsToV4(g[1]!, g[2]!));
  // Unique local fc00::/7
  if ((g[0]! & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10 and deprecated site-local fec0::/10
  if ((g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0) return true;
  // Multicast ff00::/8
  if ((g[0]! & 0xff00) === 0xff00) return true;
  return false;
}

/**
 * True when `addr` is a private, loopback, link-local, reserved or otherwise
 * non-public address. Unparseable input is treated as private (fail closed).
 */
export function isPrivateAddress(addr: string): boolean {
  const v4 = parseIPv4(addr);
  if (v4 !== null) return isPrivateIPv4Int(v4);
  const v6 = parseIPv6(addr);
  if (v6 !== null) return isPrivateIPv6Groups(v6);
  return true;
}
