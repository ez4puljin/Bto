import { Inject, Injectable } from '@nestjs/common';
import { ElevenLabsClient } from './elevenlabs.client';
import { ELEVENLABS_CONFIG, ELEVENLABS_FETCH } from './elevenlabs.tokens';
import {
  type ElevenLabsConfig,
  type ElevenLabsConversation,
  ElevenLabsError,
  type ElevenLabsFetch,
} from './elevenlabs.types';

/**
 * The phone line's agent at ElevenLabs (ADR-0232). Flow services and jobs inject it and call it
 * between transactions (TX_GUARD). Without `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` it is
 * not configured: every call throws NOT_CONFIGURED and the phone rings for staff.
 */
@Injectable()
export class ElevenLabsGateway {
  private readonly client: ElevenLabsClient | null;

  constructor(
    @Inject(ELEVENLABS_CONFIG) config: ElevenLabsConfig | null,
    @Inject(ELEVENLABS_FETCH) fetchFn: ElevenLabsFetch,
  ) {
    this.client = config ? new ElevenLabsClient(config, fetchFn) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** A signed URL for one conversation with the agent, within `timeoutMs` or an `ElevenLabsError`. */
  getSignedUrl(timeoutMs: number): Promise<string> {
    return this.ready().getSignedUrl(timeoutMs);
  }

  getConversation(conversationId: string): Promise<ElevenLabsConversation> {
    return this.ready().getConversation(conversationId);
  }

  private ready(): ElevenLabsClient {
    if (!this.client) throw new ElevenLabsError('NOT_CONFIGURED', 'the agent is not configured');
    return this.client;
  }
}
