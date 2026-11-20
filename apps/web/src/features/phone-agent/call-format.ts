import type { PhoneCall, PhoneCallMessage, PhoneCallOutcome } from './phone-agent-api';

/** «2:05» for 125 seconds. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const rest = whole % 60;
  return `${Math.floor(whole / 60)}:${rest < 10 ? '0' : ''}${rest}`;
}

/** The caller as the list shows it: the number the phone gave, or nothing for a withheld one. */
export function callerOf(call: PhoneCall): string | null {
  return call.callerPhone ?? call.callerRaw;
}

/** A tool row of the transcript: its name and whether the search found nothing. */
export function toolOf(message: PhoneCallMessage): {
  name: string;
  noHit: boolean;
  code: string | null;
} {
  const code = message.meta.code;
  return {
    name: message.text,
    noHit: message.meta.no_hit === true,
    code: typeof code === 'string' ? code : null,
  };
}

export const OUTCOMES: readonly PhoneCallOutcome[] = [
  'ORDERED',
  'STATUS_ONLY',
  'CALLBACK',
  'NO_MATCH',
  'ABANDONED',
  'FAILED',
];

export const OUTCOME_TONE: Record<
  PhoneCallOutcome,
  'success' | 'secondary' | 'warning' | 'destructive' | 'outline'
> = {
  ORDERED: 'success',
  STATUS_ONLY: 'secondary',
  CALLBACK: 'warning',
  NO_MATCH: 'outline',
  ABANDONED: 'outline',
  FAILED: 'destructive',
};
