import { describe, expect, it } from 'vitest';
import { isHealthAnswer, normalizeServerUrl } from './server-url';

describe('server address', () => {
  it('adds http:// to an address typed without a scheme and keeps the port', () => {
    expect(normalizeServerUrl(' 192.168.1.10:3300 ')).toBe('http://192.168.1.10:3300');
    expect(normalizeServerUrl('bto-pc.local:3300')).toBe('http://bto-pc.local:3300');
    expect(normalizeServerUrl('HTTPS://Bto.Example.mn')).toBe('https://bto.example.mn');
  });

  it('drops a pasted path and never invents a port', () => {
    expect(normalizeServerUrl('http://192.168.1.10:3300/api/v1/')).toBe('http://192.168.1.10:3300');
    expect(normalizeServerUrl('192.168.1.10')).toBe('http://192.168.1.10');
    expect(normalizeServerUrl('[fd00::5]:3300')).toBe('http://[fd00::5]:3300');
  });

  it('refuses what is not an address', () => {
    for (const input of ['', '   ', 'ftp://host', 'http://', 'host:0', 'host:70000', 'a b', '-x']) {
      expect(normalizeServerUrl(input)).toBeNull();
    }
  });

  it('recognises the API health answer only', () => {
    expect(isHealthAnswer({ status: 'ok', db: 'up', pgboss: 'up', version: 'dev' })).toBe(true);
    expect(isHealthAnswer({ status: 'degraded', version: 'dev' })).toBe(true);
    expect(isHealthAnswer({ status: 'fine', version: 'dev' })).toBe(false);
    expect(isHealthAnswer('<html>')).toBe(false);
    expect(isHealthAnswer(null)).toBe(false);
  });
});
