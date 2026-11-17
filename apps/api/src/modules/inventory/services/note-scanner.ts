// The address rule of a scanner the api may call (ADR-0210): only a device of the building's own
// network, by its number. A name is refused (it could resolve anywhere), and so is anything that
// is not a private IPv4 address, so the setting can never point the server at the internet.

/** Where the sheet lies: on the glass, or in the feeder on top (the scanner client's sources). */
export const NOTE_SCAN_SOURCES = ['GLASS', 'FEEDER'] as const;

const OCTET = '(25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/** 10.x.x.x, 172.16–31.x.x and 192.168.x.x: the ranges a building's network uses. */
function isPrivateIpv4(host: string): boolean {
  const match = IPV4.exec(host);
  if (!match) return false;
  const [a, b] = [Number.parseInt(match[1] ?? '', 10), Number.parseInt(match[2] ?? '', 10)];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * A scanner's address as it is kept: `http://192.168.1.60` (or https, or with a port), nothing
 * after the host. Null when the text is anything else. `192.168.1.60` alone is read as http.
 */
export function scannerUrlOf(value: string): string | null {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (!isPrivateIpv4(url.hostname)) return null;
  return `${url.protocol}//${url.host}`;
}
