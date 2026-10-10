import { parseEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgres://app:pw@127.0.0.1:15432/tugeel',
  DB_POOL_MAX: '6',
  PGBOSS_POOL_MAX: '2',
  JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop',
  AUTH_PEPPER: 'test-auth-pepper-0123456789abcdefghijklmnop',
};

describe('parseEnv', () => {
  it('coerces numbers and applies defaults', () => {
    const env = parseEnv(base, 'api');
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      WORKER_HEALTH_PORT: 3001,
      LOG_LEVEL: 'info',
      DB_POOL_MAX: 6,
      PGBOSS_POOL_MAX: 2,
      APP_VERSION: 'dev',
    });
  });

  it('requires the pool budget to be explicit and numeric', () => {
    expect(() => parseEnv({ ...base, DB_POOL_MAX: undefined }, 'api')).toThrow('DB_POOL_MAX');
    expect(() => parseEnv({ ...base, DB_POOL_MAX: 'six' }, 'api')).toThrow('DB_POOL_MAX');
    expect(() => parseEnv({ ...base, PGBOSS_POOL_MAX: '0' }, 'api')).toThrow('PGBOSS_POOL_MAX');
  });

  it('accepts only PostgreSQL URLs', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://app@db/tugeel' }, 'api')).toThrow(
      'DATABASE_URL',
    );
    expect(parseEnv({ ...base, DATABASE_URL: 'postgresql://a:b@h/d' }, 'api').DATABASE_URL).toBe(
      'postgresql://a:b@h/d',
    );
  });

  it('refuses a ROLE that does not match the entrypoint', () => {
    expect(() => parseEnv({ ...base, ROLE: 'worker' }, 'api')).toThrow(
      'ROLE=worker but this is the api entrypoint',
    );
    expect(parseEnv({ ...base, ROLE: 'worker' }, 'worker').ROLE).toBe('worker');
  });

  it('requires the token secrets only in the api process', () => {
    const { JWT_SECRET: _jwt, AUTH_PEPPER: _pepper, ...withoutSecrets } = base;
    expect(() => parseEnv(withoutSecrets, 'api')).toThrow('JWT_SECRET is required');
    expect(() => parseEnv({ ...withoutSecrets, JWT_SECRET: base.JWT_SECRET }, 'api')).toThrow(
      'AUTH_PEPPER is required',
    );
    expect(parseEnv(withoutSecrets, 'worker').JWT_SECRET).toBeUndefined();
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' }, 'api')).toThrow('JWT_SECRET');
  });

  it('refuses development placeholders in production', () => {
    const dev = { ...base, NODE_ENV: 'production', JWT_SECRET: 'dev-'.padEnd(40, 'x') };
    expect(() => parseEnv(dev, 'api')).toThrow('JWT_SECRET is a development placeholder');
    expect(parseEnv({ ...dev, NODE_ENV: 'development' }, 'api').NODE_ENV).toBe('development');
  });

  it('marks the refresh cookie Secure by default only in production', () => {
    expect(parseEnv(base, 'api').COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...base, NODE_ENV: 'production' }, 'api').COOKIE_SECURE).toBe(true);
    expect(
      parseEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }, 'api').COOKIE_SECURE,
    ).toBe(false);
    expect(parseEnv({ ...base, COOKIE_SECURE: 'true' }, 'api').COOKIE_SECURE).toBe(true);
    expect(() => parseEnv({ ...base, COOKIE_SECURE: 'maybe' }, 'api')).toThrow('COOKIE_SECURE');
  });
});
