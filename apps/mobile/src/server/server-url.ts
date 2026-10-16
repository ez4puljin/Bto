/** Scheme, host (a name, an IPv4 address or a bracketed IPv6 address) and port; any path is dropped. */
const SERVER =
  /^(?:(https?):\/\/)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::(\d{1,5}))?(?:[/?#].*)?$/i;

/**
 * The API server's origin as the rep typed it, e.g. «192.168.1.10:3300» → «http://192.168.1.10:3300»
 * (ADR-0061 #2): plain HTTP unless the address says https; never a port that was not typed. Null
 * when it is not an address. The generated API paths already start with /api/v1.
 */
export function normalizeServerUrl(input: string): string | null {
  const match = SERVER.exec(input.trim());
  if (!match) return null;
  const [, scheme, host, port] = match;
  if (!host) return null;
  if (port !== undefined) {
    const value = Number.parseInt(port, 10);
    if (value < 1 || value > 65_535) return null;
  }
  return `${(scheme ?? 'http').toLowerCase()}://${host.toLowerCase()}${port ? `:${port}` : ''}`;
}

export interface HealthAnswer {
  status: 'ok' | 'degraded';
  version: string;
}

/** Whether a body is the API's GET /health answer (and not some other web page on that address). */
export function isHealthAnswer(body: unknown): body is HealthAnswer {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    (body.status === 'ok' || body.status === 'degraded') &&
    'version' in body &&
    typeof body.version === 'string'
  );
}
