import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/db/db.types';
import { PermissionHoldersService } from '../../identity';
import type { PhoneAgentListener, PhoneCallbackNotice, PhoneOrderNotice } from '../../phone-agent';
import { userNotifications } from '../schema';

/** Who is told of the phone AI line's orders and callbacks (ADR-0232 #9, #10). */
const RECIPIENT_PERMISSION = 'phone.calls.read';

/**
 * Tells the staff at once of a new PHONE_AI order and of a new callback task (ADR-0232 #9): one
 * `user_notifications` row for every active holder of `phone.calls.read`, written inside the
 * transaction that made the order or the task. Bound to phone-agent's `PHONE_AGENT_LISTENER`;
 * phone-agent never imports this module. A row per recipient and document, so a statement that
 * runs twice changes nothing.
 */
@Injectable()
export class PhoneNotifier implements PhoneAgentListener {
  constructor(private readonly holders: PermissionHoldersService) {}

  async onPhoneOrder(tx: Tx, notice: PhoneOrderNotice): Promise<void> {
    const userIds = await this.holders.activeHolders(RECIPIENT_PERMISSION, {}, tx);
    if (userIds.length === 0) return;
    await tx
      .insert(userNotifications)
      .values(
        userIds.map((userId) => ({
          userId,
          kind: 'PHONE_ORDER' as const,
          orderId: notice.orderId,
          payload: {
            orderNumber: notice.orderNumber,
            customerId: notice.customerId,
            customerName: notice.customerName,
            callId: notice.callId,
          },
        })),
      )
      .onConflictDoNothing();
  }

  async onPhoneCallback(tx: Tx, notice: PhoneCallbackNotice): Promise<void> {
    const userIds = await this.holders.activeHolders(RECIPIENT_PERMISSION, {}, tx);
    if (userIds.length === 0) return;
    await tx
      .insert(userNotifications)
      .values(
        userIds.map((userId) => ({
          userId,
          kind: 'PHONE_CALLBACK' as const,
          callbackId: notice.callbackId,
          payload: {
            customerId: notice.customerId,
            customerName: notice.customerName,
            phone: notice.phone,
            callId: notice.callId,
          },
        })),
      )
      .onConflictDoNothing();
  }
}
