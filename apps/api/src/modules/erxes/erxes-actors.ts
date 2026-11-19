import { type Actor, type AuthContext, systemActor } from '../identity';

/** Who a copied order is entered by: a Bto user, or nobody in Bto (the erxes name is kept). */
export interface OrderAuthor {
  userId: number | null;
  /** The creator's name in erxes. */
  erxesName: string | null;
}

/** The actor of everything the pull does by itself. */
export const ERXES_JOB_ACTOR: Actor = systemActor('job:erxes.pull');

/**
 * A staff context without rights, for `CustomersService.list`, which takes one and reads every
 * customer whoever asks. It signs nothing in and passes no permission check: every right it could
 * be asked for is absent.
 */
export const ERXES_READER: AuthContext = {
  kind: 'STAFF',
  userId: 0,
  sessionId: 'erxes',
  username: 'erxes',
  fullName: 'erxes',
  phone: null,
  permissions: new Set(),
  roleIds: [],
  writableWarehouseIds: new Set(),
  companyPermissions: new Map(),
};

/**
 * The author `createInTx` records. With a Bto user the order is theirs (`created_by`). Without one
 * the order has no Bto author and its first event carries the erxes name as its label.
 */
export function orderAuthor(author: OrderAuthor): Actor {
  if (author.userId !== null) return { kind: 'STAFF', userId: author.userId };
  return systemActor(`erxes:${(author.erxesName ?? '').slice(0, 80)}`);
}
