import { Injectable, Logger } from '@nestjs/common';
import { ElevenLabsError, ElevenLabsGateway } from '../../../integrations/elevenlabs';
import { type PhoneDeclineReason, PHONE_LIMITS } from '../phone-agent.rules';
import { PhoneCallsService } from './phone-calls.service';
import { PhoneProductSearchService } from './phone-product-search.service';
import { type PhoneLine, staffAnswer } from './phone-lines.service';

/** What the bridge hands the agent when the conversation starts (dynamic variables, ADR-0232 #15). */
export type DynamicVariables = Record<string, string | number | boolean>;

export type CallStart =
  | { answer: false; callId: number; reason: PhoneDeclineReason }
  | { answer: true; callId: number; signedUrl: string; dynamicVariables: DynamicVariables };

/** What the station shows about itself, and whether a call now would be answered. */
export interface StationStatus {
  lineId: number;
  name: string;
  active: boolean;
  /** Inside the line's working hours now: staff answer. */
  workingHours: boolean;
  agentConfigured: boolean;
}

/**
 * `POST /phone-agent/calls` (ADR-0232 #3): the call is stored and the decision taken in one
 * transaction; the signed URL is fetched after it, between transactions (TX_GUARD), within
 * `signedUrlTimeoutMs`, so the answer comes well inside Android's three seconds. Any doubt answers
 * `answer: false` and the phone rings for staff as before.
 */
@Injectable()
export class PhoneCallFlowService {
  private readonly logger = new Logger(PhoneCallFlowService.name);

  constructor(
    private readonly calls: PhoneCallsService,
    private readonly agent: ElevenLabsGateway,
    private readonly products: PhoneProductSearchService,
  ) {}

  async start(
    line: PhoneLine,
    input: { callRef: string; callerPhone: string | null },
  ): Promise<CallStart> {
    const startedAt = Date.now();
    const opened = await this.calls.open(line, input, this.agent.configured);
    const { call } = opened;
    if (!call.answered || call.endedAt !== null) {
      return { answer: false, callId: call.id, reason: call.declineReason ?? 'AGENT_UNAVAILABLE' };
    }
    let signedUrl: string;
    try {
      signedUrl = await this.agent.getSignedUrl(PHONE_LIMITS.signedUrlTimeoutMs);
    } catch (error) {
      await this.calls.failToAnswer(call.id);
      // Codes and milliseconds only: never the URL, the key or the caller's number.
      this.logger.warn(
        {
          callId: call.id,
          code: error instanceof ElevenLabsError ? error.code : 'UNKNOWN',
          status: error instanceof ElevenLabsError ? error.status : null,
          ms: Date.now() - startedAt,
        },
        'phone call not answered: no signed url',
      );
      return { answer: false, callId: call.id, reason: 'AGENT_UNAVAILABLE' };
    }
    this.logger.log({ callId: call.id, ms: Date.now() - startedAt }, 'phone call answered');
    // The caller will name products within seconds: the search's index is ready by then.
    this.products.warm();
    return {
      answer: true,
      callId: call.id,
      signedUrl,
      dynamicVariables: {
        call_id: String(call.id),
        caller_known: opened.customer !== null,
        store_name: opened.customer?.name ?? '',
        can_deliver: opened.canDeliver,
        greeting: line.greeting ?? '',
      },
    };
  }

  /**
   * The station's heartbeat: cheap, no provider call. It lets the bridge tell Android «do not
   * answer» at once in working hours; `POST /calls` still decides each call.
   */
  status(line: PhoneLine, now: Date = new Date()): StationStatus {
    return {
      lineId: line.id,
      name: line.name,
      active: line.active,
      workingHours: staffAnswer(line, now),
      agentConfigured: this.agent.configured,
    };
  }
}
