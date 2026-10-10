import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Typed access to the validated environment. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** For values that parseEnv guarantees for this process role (e.g. JWT_SECRET in the api). */
  require<K extends keyof Env>(key: K): NonNullable<Env[K]> {
    const value = this.get(key);
    if (value === undefined || value === null) throw new Error(`${key} is not configured`);
    return value;
  }
}
