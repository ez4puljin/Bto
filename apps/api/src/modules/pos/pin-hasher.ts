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
  /** The key an edge needs (ADR-0136): POS_PIN_PEPPER, AUTH_PEPPER only outside production. */
  private readonly edgeKey: string | null;
  private dummyHash = '';

  constructor(config: AppConfig) {
    const own = config.get('POS_PIN_PEPPER');
    const pepper = own ?? config.require('AUTH_PEPPER');
    this.edgeKey = own ?? (config.get('NODE_ENV') === 'production' ? null : pepper);
    this.options =
      config.get('NODE_ENV') === 'test'
        ? { ...TEST, secret: Buffer.from(pepper) }
        : { ...PRODUCTION, secret: Buffer.from(pepper) };
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(8).toString('hex'));
  }

  /**
   * The PIN key a linked edge checks the hashes with; null in production without POS_PIN_PEPPER,
   * where the staff's AUTH_PEPPER is never handed out.
   */
  sharedKey(): string | null {
    return this.edgeKey;
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
