import { streamDuration } from './live-stock.hub';

const token = (claims: object) =>
  `Bearer h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('a live stock stream’s length (ADR-0173 #4)', () => {
  const now = 1_800_000_000_000;

  it('ends at the access token’s expiry', () => {
    expect(streamDuration(token({ exp: now / 1_000 + 600 }), now)).toBe(600_000);
  });

  it('lasts at least a second, even for a token about to expire', () => {
    expect(streamDuration(token({ exp: now / 1_000 - 5 }), now)).toBe(1_000);
  });

  it('falls back to 14 minutes without a readable expiry', () => {
    expect(streamDuration(undefined, now)).toBe(14 * 60_000);
    expect(streamDuration('Bearer not-a-jwt', now)).toBe(14 * 60_000);
    expect(streamDuration(token({ sub: '1' }), now)).toBe(14 * 60_000);
  });
});
