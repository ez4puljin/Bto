import { ReceiptSecretsCache, SECRETS_TTL_MS } from './receipt-secrets.cache';

describe('ReceiptSecretsCache (ADR-0185 #6)', () => {
  const secrets = { lottery: 'TEST-LOT-1', qrData: 'TEST-QR-1' };

  it('hands the secrets out once', () => {
    const cache = new ReceiptSecretsCache();
    cache.put(1, secrets, 1_000);
    expect(cache.has(1, 1_001)).toBe(true);
    expect(cache.take(1, 1_002)).toEqual(secrets);
    expect(cache.has(1, 1_003)).toBe(false);
    expect(cache.take(1, 1_003)).toBeNull();
  });

  it('forgets them after the time limit', () => {
    const cache = new ReceiptSecretsCache();
    cache.put(1, secrets, 0);
    expect(cache.has(1, SECRETS_TTL_MS - 1)).toBe(true);
    expect(cache.has(1, SECRETS_TTL_MS)).toBe(false);
    expect(cache.take(1, SECRETS_TTL_MS)).toBeNull();
  });

  it('keeps nothing for a receipt without secrets, and drops a cancelled one’s', () => {
    const cache = new ReceiptSecretsCache();
    cache.put(1, { lottery: null, qrData: null });
    expect(cache.has(1)).toBe(false);
    cache.put(2, secrets);
    cache.forget(2);
    expect(cache.take(2)).toBeNull();
  });

  it('holds a bounded number of receipts, oldest dropped first', () => {
    const cache = new ReceiptSecretsCache();
    for (let id = 1; id <= 501; id += 1) cache.put(id, secrets, 0);
    expect(cache.has(1, 1)).toBe(false);
    expect(cache.has(2, 1)).toBe(true);
    expect(cache.has(501, 1)).toBe(true);
  });
});
