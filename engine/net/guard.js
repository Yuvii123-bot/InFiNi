// INFINI AI — outbound request guard (SSRF protection).
// Every URL the engine touches (search results, redirects, user-supplied links) passes through here.

export class BlockedError extends Error {
  constructor(message, code = 'blocked') { super(message); this.name = 'BlockedError'; this.code = code; }
}

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([ip, bits]) => [v4ToInt(ip), bits]);

function v4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x)) return null;
    const b = Number(x);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

export function isBlockedIPv4(ip) {
  const n = v4ToInt(ip);
  if (n === null) return true;                       // unparsable → refuse
  for (const [base, bits] of V4_BLOCKS) {
    const size = 2 ** (32 - bits);
    if (n >= base && n < base + size) return true;
  }
  return false;
}

/** Expand an IPv6 literal into 8 16-bit groups, or null if malformed. */
export function parseIPv6(ip) {
  ip = ip.replace(/^\[|\]$/g, '');
  if (ip.includes('%')) return null;                 // zone identifiers are never legitimate here
  let tail = [];
  const lastColon = ip.lastIndexOf(':');
  if (ip.includes('.')) {
    const n = v4ToInt(ip.slice(lastColon + 1));
    if (n === null) return null;
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    ip = ip.slice(0, lastColon) + ':0:0';            // placeholder, replaced below
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parse = (s) => (s === '' ? [] : s.split(':').map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (head.some(Number.isNaN) || rest.some(Number.isNaN)) return null;
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array(fill).fill(0), ...rest];
  } else groups = head;
  if (groups.length !== 8) return null;
  if (tail.length) { groups[6] = tail[0]; groups[7] = tail[1]; }
  return groups;
}

const g2v4 = (a, b) => `${a >>> 8}.${a & 255}.${b >>> 8}.${b & 255}`;

export function isBlockedIPv6(ip) {
  const g = parseIPv6(ip);
  if (!g) return true;
  const zeroTo = (n) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return true;                                        // ::
  if (zeroTo(7) && g[7] === 1) return true;                          // ::1 loopback
  if (zeroTo(5) && g[5] === 0xffff) return isBlockedIPv4(g2v4(g[6], g[7]));   // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeroTo(6)) return true;                                        // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || g[3] !== 0 || g[4] !== 0 || g[5] !== 0 || isBlockedIPv4(g2v4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedIPv4(g2v4(g[1], g[2]));       // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                    // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;                // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;  // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true;                       // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                       // fe80::/10 link local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                       // fec0::/10 site local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true;                       // multicast
  return false;
}

export function ipFamily(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return 4;
  if (h.includes(':')) return 6;
  return 0;
}

export function isBlockedAddress(ip) {
  const fam = ipFamily(ip);
  if (fam === 4) return isBlockedIPv4(ip);
  if (fam === 6) return isBlockedIPv6(ip);
  return true;
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.private', '.localdomain', '.home.arpa', '.onion', '.test', '.invalid', '.example'];

/**
 * Validate a URL before any network activity. Returns a WHATWG URL or throws BlockedError.
 * DNS-level validation (resolved addresses) happens separately in the HTTP client.
 */
export function validateUrl(raw, { allowPorts = [80, 443] } = {}) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new BlockedError('URL is missing or too long', 'bad_url');
  let u;
  try { u = new URL(raw.trim()); } catch { throw new BlockedError('URL could not be parsed', 'bad_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedError(`Protocol ${u.protocol} is not allowed`, 'bad_protocol');
  if (u.username || u.password) throw new BlockedError('URLs with embedded credentials are not allowed', 'credentials');
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (!allowPorts.includes(port)) throw new BlockedError(`Port ${port} is not allowed`, 'bad_port');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new BlockedError('URL has no host', 'bad_url');
  const fam = ipFamily(host);
  if (fam) {
    if (isBlockedAddress(host)) throw new BlockedError('Address is private, loopback or reserved', 'private_address');
  } else {
    if (host === 'localhost' || !host.includes('.')) throw new BlockedError('Local host names are not allowed', 'private_host');
    for (const s of BLOCKED_SUFFIXES) if (host.endsWith(s)) throw new BlockedError(`Host suffix ${s} is not allowed`, 'private_host');
    if (!/^[a-z0-9.\-_]+$/.test(host)) throw new BlockedError('Host name contains invalid characters', 'bad_url');
  }
  return u;
}
