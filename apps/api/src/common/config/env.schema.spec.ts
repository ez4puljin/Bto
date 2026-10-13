import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgres://app:pw@127.0.0.1:15432/tugeel',
  DB_POOL_MAX: '6',
  PGBOSS_POOL_MAX: '2',
  JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop',
  AUTH_PEPPER: 'test-auth-pepper-0123456789abcdefghijklmnop',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: '../../.data/storage',
};

describe('parseEnv', () => {
  it('coerces numbers and applies defaults', () => {
    const env = parseEnv(base, 'api');
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
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

  it('refuses the Spaces driver before the go-live phase and needs a local directory', () => {
    const { STORAGE_DRIVER: _driver, ...defaultDriver } = base;
    expect(() => parseEnv(defaultDriver, 'worker')).toThrow('STORAGE_DRIVER=spaces');
    const { STORAGE_LOCAL_DIR: _dir, ...withoutDir } = base;
    expect(() => parseEnv(withoutDir, 'api')).toThrow('STORAGE_LOCAL_DIR is required');
    const dir = parseEnv(base, 'api').STORAGE_LOCAL_DIR;
    expect(isAbsolute(dir)).toBe(true);
    expect(dir).toBe(resolve('../../.data/storage'));
  });

  describe('AI assistant (ADR-0045)', () => {
    const ai = {
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'test-model',
      LLM_API_KEY: 'sk-test-not-a-real-key',
      AI_DATABASE_URL: 'postgres://ai_reader:pw@127.0.0.1:15432/tugeel',
      AI_POOL_MAX: '2',
    };

    it('is off by default; empty values count as unset', () => {
      const off = parseEnv(base, 'api');
      expect(off.LLM_PROVIDER).toBeUndefined();
      expect(off.LLM_TIMEOUT_MS).toBe(60_000);
      const blank = parseEnv(
        { ...base, LLM_PROVIDER: '', LLM_API_KEY: '', AI_DATABASE_URL: '', LLM_TIMEOUT_MS: '' },
        'api',
      );
      expect(blank).toMatchObject({ LLM_PROVIDER: undefined, AI_DATABASE_URL: undefined });
      expect(blank.LLM_TIMEOUT_MS).toBe(60_000);
    });

    it('accepts a complete configuration', () => {
      expect(parseEnv({ ...base, ...ai, LLM_TIMEOUT_MS: '90000' }, 'api')).toMatchObject({
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'test-model',
        AI_POOL_MAX: 2,
        LLM_TIMEOUT_MS: 90_000,
      });
    });

    it('names what an enabled provider is missing', () => {
      const { LLM_MODEL: _model, LLM_API_KEY: _key, AI_DATABASE_URL: _url, ...partial } = ai;
      expect(() => parseEnv({ ...base, ...partial }, 'api')).toThrow(
        'LLM_PROVIDER=openai needs LLM_MODEL, LLM_API_KEY, AI_DATABASE_URL',
      );
      expect(() => parseEnv({ ...base, ...ai, LLM_PROVIDER: 'gemini' }, 'api')).toThrow(
        'LLM_PROVIDER',
      );
    });

    it('runs Ollama without a key', () => {
      const { LLM_API_KEY: _key, ...local } = ai;
      expect(parseEnv({ ...base, ...local, LLM_PROVIDER: 'ollama' }, 'api').LLM_API_KEY).toBe(
        undefined,
      );
    });

    it('connects only as ai_reader, with an explicit pool', () => {
      expect(() =>
        parseEnv(
          { ...base, ...ai, AI_DATABASE_URL: 'postgres://app:pw@127.0.0.1:15432/tugeel' },
          'api',
        ),
      ).toThrow('AI_DATABASE_URL must connect as ai_reader');
      expect(() => parseEnv({ ...base, ...ai, AI_POOL_MAX: undefined }, 'api')).toThrow(
        'AI_POOL_MAX is required with AI_DATABASE_URL',
      );
      expect(() => parseEnv({ ...base, ...ai, AI_POOL_MAX: '5' }, 'api')).toThrow('AI_POOL_MAX');
    });

    it('asks nothing of the worker', () => {
      expect(parseEnv({ ...base, LLM_PROVIDER: 'openai' }, 'worker').LLM_PROVIDER).toBe('openai');
    });
  });
});
