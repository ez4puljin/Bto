import { parseEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgres://app:pw@127.0.0.1:15432/tugeel',
  DB_POOL_MAX: '6',
  PGBOSS_POOL_MAX: '2',
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
});
