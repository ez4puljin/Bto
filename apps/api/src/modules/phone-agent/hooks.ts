import type { Tx } from '../../common/db/db.types';

/**
 * What the phone AI line tells whoever listens (ADR-0232 #9), by value, inside the transaction
 * that wrote it: a new PHONE_AI order and a new callback task. Notifications binds the token with
 * `useExisting`; `PhoneToolsService` resolves it through `ModuleRef` (`strict: false`) and does
 * without it when nothing is bound. Nobody in this module imports notifications.
 */
export interface PhoneOrderNotice {
  callId: number;
  orderId: number;
  orderNumber: string;
  customerId: number;
  customerName: string;
}

export interface PhoneCallbackNotice {
  callId: number;
  callbackId: number;
  /** Null for a caller the line did not recognise. */
  customerId: number | null;
  customerName: string | null;
  /** The number to ring back; null when it was withheld. */
  phone: string | null;
}

export interface PhoneAgentListener {
  /** Statements in the caller's transaction; an error aborts it (never caught, 25P02). */
  onPhoneOrder(tx: Tx, notice: PhoneOrderNotice): Promise<void>;
  onPhoneCallback(tx: Tx, notice: PhoneCallbackNotice): Promise<void>;
}

export const PHONE_AGENT_LISTENER = Symbol('PHONE_AGENT_LISTENER');
