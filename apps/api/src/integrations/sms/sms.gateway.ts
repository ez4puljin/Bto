import { Inject, Injectable } from '@nestjs/common';
import { SMS_FETCH } from './sms.tokens';
import type { SmsFetch } from './sms.types';
import { WesendClient } from './wesend.client';

/** WeSend for one key: a fresh client per use, so a changed key works at once (ADR-0216). */
@Injectable()
export class SmsGateway {
  constructor(@Inject(SMS_FETCH) private readonly fetchFn: SmsFetch) {}

  clientFor(apiKey: string): WesendClient {
    return new WesendClient(apiKey, this.fetchFn);
  }
}
