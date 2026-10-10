import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { normalizePassword } from '@tugeel/shared/auth';
import { argon2id, hash, type HashOptions, verify } from 'argon2';
import { AppConfig } from '../../../common/config/app-config';

/** OWASP minimum for argon2id (19 MiB, t=2, p=1); tests use cheaper parameters. */
const PRODUCTION: HashOptions = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const TEST: HashOptions = { type: argon2id, memoryCost: 4_096, timeCost: 1, parallelism: 1 };

/**
 * argon2id over NFC-normalised passwords (ADR-0027 #9). Unknown users and users without a password
 * are checked against a dummy hash, so every failed login costs the same time.
 */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  private readonly options: HashOptions;
  private dummyHash = '';

  constructor(config: AppConfig) {
    this.options = config.get('NODE_ENV') === 'test' ? TEST : PRODUCTION;
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(16).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return hash(normalizePassword(password), this.options);
  }

  /** False for a missing hash (after the same work as a real check) or a wrong password. */
  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const candidate = normalizePassword(password);
    if (!passwordHash) {
      await verify(this.dummyHash, candidate).catch(() => false);
      return false;
    }
    try {
      return await verify(passwordHash, candidate);
    } catch {
      return false;
    }
  }
}
