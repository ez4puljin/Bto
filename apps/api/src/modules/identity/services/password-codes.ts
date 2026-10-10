import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { SETUP_CODE_TTL_MINUTES } from '../auth.constants';
import { passwordResets } from '../schema';
import { hashSetupCode, newSetupCode } from './tokens';

export interface IssuedCode {
  /** Shown once to the admin; only its HMAC is stored. */
  code: string;
  expiresAt: Date;
}

/**
 * Issues a one-time code for a user to set their own password (ADR-0027 #9), revoking the previous
 * live code. A plain function so the create-admin CLI can use it without Nest.
 */
export async function issuePasswordCode(
  tx: Tx,
  args: { userId: number; createdBy: number | null; pepper: string },
): Promise<IssuedCode> {
  await tx
    .update(passwordResets)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(passwordResets.userId, args.userId),
        isNull(passwordResets.usedAt),
        isNull(passwordResets.revokedAt),
      ),
    );
  const code = newSetupCode();
  const [row] = await tx
    .insert(passwordResets)
    .values({
      userId: args.userId,
      codeHash: hashSetupCode(args.pepper, code),
      createdBy: args.createdBy,
      expiresAt: sql`now() + make_interval(mins => ${SETUP_CODE_TTL_MINUTES})`,
    })
    .returning({ expiresAt: passwordResets.expiresAt });
  if (!row) throw new Error('password code insert returned no row');
  return { code, expiresAt: row.expiresAt };
}
