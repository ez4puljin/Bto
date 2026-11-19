import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { type AuthContext, UserNamesService } from '../../identity';
import { RepVisitsService } from '../../sales';

/** Answering every store's conversation, and only those of one's own round (ADR-0224 #5). */
export const CHAT_ANSWER = 'chat.answer';
export const CHAT_ANSWER_OWN = 'chat.answer_own';

/** Whose conversations a staff member may read and answer: every store's, or these stores'. */
export type ChatScope = { all: true } | { all: false; customerIds: ReadonlySet<number> };

/** The store's sales rep as «Залгах» needs them (ADR-0224 #4). */
export interface ChatRep {
  id: number;
  name: string;
  phone: string | null;
}

/**
 * Who a store's sales rep is, and which stores a rep answers (ADR-0224 #3): a customer has no rep
 * column, so both come from the reps' weekly rounds, read through the sales module.
 */
@Injectable()
export class ChatRepsService {
  constructor(
    private readonly users: UserNamesService,
    private readonly rounds: RepVisitsService,
  ) {}

  /**
   * The conversations `ctx` may read and answer: every store's with `chat.answer`, the stores of
   * the caller's own round with `chat.answer_own`; 403 FORBIDDEN with neither.
   */
  async scopeOf(ctx: AuthContext): Promise<ChatScope> {
    if (ctx.permissions.has(CHAT_ANSWER)) return { all: true };
    if (ctx.permissions.has(CHAT_ANSWER_OWN)) {
      return { all: false, customerIds: new Set(await this.rounds.roundCustomerIds(ctx.userId)) };
    }
    throw new AppError('FORBIDDEN', `the chat needs ${CHAT_ANSWER} or ${CHAT_ANSWER_OWN}`, {
      permission: CHAT_ANSWER,
    });
  }

  /** The active reps on whose round each store stands, lowest user id first. */
  async repsOf(customerIds: readonly number[]): Promise<Map<number, ChatRep[]>> {
    const byCustomer = await this.rounds.roundRepIds(customerIds);
    const summaries = await this.users.summariesOf([...byCustomer.values()].flat());
    const reps = new Map<number, ChatRep[]>();
    for (const [customerId, userIds] of byCustomer) {
      const active = userIds.flatMap((id) => {
        const user = summaries.get(id);
        return user?.status === 'ACTIVE'
          ? [{ id: user.id, name: user.fullName, phone: user.phone }]
          : [];
      });
      if (active.length > 0) reps.set(customerId, active);
    }
    return reps;
  }

  /** The rep «Залгах» calls: the first of the store's reps, or null when it stands on no round. */
  async repOf(customerId: number): Promise<ChatRep | null> {
    return (await this.repsOf([customerId])).get(customerId)?.[0] ?? null;
  }
}
