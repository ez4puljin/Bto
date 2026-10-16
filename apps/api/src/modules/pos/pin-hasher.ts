import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { argon2id, hash, type HashOptions, verify } from 'argon2';
import { AppConfig } from '../../common/config/app-config';

/** OWASP minimum for argon2id (19 MiB, t=2, p=1); tests use cheaper parameters. */
const PRODUCTION: HashOptions = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const TEST: HashOptions = { type: argon2id, memoryCost: 4_096, timeCost: 1, parallelism: 1 };

/**
 * argon2id over a cashier's PIN, keyed with POS_PIN_PEPPER (ADR-0063 #6): six digits are few, so
 * a hash copied to the store's edge is useless without the key both sides hold. Falls back to
 * AUTH_PEPPER until the owner sets the POS key.
 */
@Injectable()
export class PinHasher implements OnModuleInit {
  private readonly options: HashOptions;
  private dummyHash = '';

  constructor(config: AppConfig) {
    const pepper = config.get('POS_PIN_PEPPER') ?? config.require('AUTH_PEPPER');
    this.options =
      config.get('NODE_ENV') === 'test'
        ? { ...TEST, secret: Buffer.from(pepper) }
        : { ...PRODUCTION, secret: Buffer.from(pepper) };
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(8).toString('hex'));
  }

  hash(pin: string): Promise<string> {
    return hash(pin, this.options);
  }

  /** False for a missing hash (after the same work as a real check) or a wrong PIN. */
  async verify(pinHash: string | null, pin: string): Promise<boolean> {
    if (!pinHash) {
      await verify(this.dummyHash, pin, this.options).catch(() => false);
      return false;
    }
    try {
      return await verify(pinHash, pin, this.options);
    } catch {
      return false;
    }
  }
}
