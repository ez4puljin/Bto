import { describe, expect, it } from 'vitest';
import {
  fieldAddress,
  forgetServer,
  isHealthAnswer,
  normalizeServerUrl,
  recentServersFrom,
  recentServerWhen,
  rememberServer,
  serverHost,
} from './server-url';

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

describe('recent servers', () => {
  const a = 'http://192.168.1.10:3301';
  const b = 'http://192.168.0.104:3300';
  const c = 'https://bto.example.mn';

  it('puts the server just used on top, once, and keeps five', () => {
    const list = rememberServer(rememberServer([], a, 1), b, 2);
    expect(list).toEqual([
      { url: b, usedAt: 2 },
      { url: a, usedAt: 1 },
    ]);
    expect(rememberServer(list, a, 3)).toEqual([
      { url: a, usedAt: 3 },
      { url: b, usedAt: 2 },
    ]);
    let many: ReturnType<typeof rememberServer> = [];
    for (let i = 1; i <= 7; i += 1) many = rememberServer(many, `http://10.0.0.${i}:3300`, i);
    expect(many.map((item) => item.url)).toEqual([
      'http://10.0.0.7:3300',
      'http://10.0.0.6:3300',
      'http://10.0.0.5:3300',
      'http://10.0.0.4:3300',
      'http://10.0.0.3:3300',
    ]);
  });

  it('forgets one server', () => {
    const list = [
      { url: a, usedAt: 2 },
      { url: b, usedAt: 1 },
    ];
    expect(forgetServer(list, a)).toEqual([{ url: b, usedAt: 1 }]);
    expect(forgetServer(list, c)).toEqual(list);
  });

  it('reads only a valid stored list, newest first, without repeats', () => {
    expect(recentServersFrom(null)).toEqual([]);
    expect(recentServersFrom('x')).toEqual([]);
    expect(recentServersFrom({ url: a, usedAt: 1 })).toEqual([]);
    expect(
      recentServersFrom([
        { url: b, usedAt: 1 },
        null,
        { url: 'not an address', usedAt: 5 },
        { url: '192.168.1.10:3301', usedAt: 5 },
        { url: c, usedAt: 'today' },
        { url: a, usedAt: Number.NaN },
        { url: a, usedAt: 3 },
        { url: a, usedAt: 2 },
        { url: c, usedAt: 4 },
      ]),
    ).toEqual([
      { url: c, usedAt: 4 },
      { url: a, usedAt: 3 },
      { url: b, usedAt: 1 },
    ]);
    const seven = Array.from({ length: 7 }, (_, i) => ({ url: `http://10.0.0.${i}`, usedAt: i }));
    expect(recentServersFrom(seven)).toHaveLength(5);
  });

  it('fills the field without http://, keeping https:// so connecting stays secure', () => {
    expect(fieldAddress('http://192.168.1.10:3301')).toBe('192.168.1.10:3301');
    expect(fieldAddress('https://bto.example.mn')).toBe('https://bto.example.mn');
    expect(normalizeServerUrl(fieldAddress('https://bto.example.mn'))).toBe(
      'https://bto.example.mn',
    );
    expect(normalizeServerUrl(fieldAddress('http://192.168.1.10:3301'))).toBe(
      'http://192.168.1.10:3301',
    );
  });

  it('shows the address without its scheme', () => {
    expect(serverHost(a)).toBe('192.168.1.10:3301');
    expect(serverHost(c)).toBe('bto.example.mn');
    expect(serverHost('192.168.1.10:3301')).toBe('192.168.1.10:3301');
  });

  it('says the time on the same day and the date before it', () => {
    const now = new Date(2026, 9, 17, 18, 30).getTime();
    expect(recentServerWhen(new Date(2026, 9, 17, 9, 12).getTime(), now)).toEqual({
      today: true,
      time: '09:12',
    });
    expect(recentServerWhen(new Date(2026, 9, 15, 23, 59).getTime(), now)).toEqual({
      today: false,
      date: '10/15',
    });
    expect(recentServerWhen(new Date(2025, 9, 17, 9, 12).getTime(), now)).toEqual({
      today: false,
      date: '10/17',
    });
  });
});
