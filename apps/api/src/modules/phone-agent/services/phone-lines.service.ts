import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { type AuthContext, AuditService } from '../../identity';
import { PhoneError } from '../phone-agent.errors';
import {
  emptySchedule,
  isWorkingTime,
  normalizeSchedule,
  PHONE_LIMITS,
  type PhoneSchedule,
  scheduleIssues,
} from '../phone-agent.rules';
import { phoneLines } from '../schema';

export interface PhoneLine {
  id: number;
  name: string;
  active: boolean;
  schedule: PhoneSchedule;
  greeting: string | null;
  lastSeenAt: Date | null;
  /** The station called within the last two minutes. */
  online: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhoneLineInput {
  name: string;
  schedule?: unknown;
  greeting?: string | null;
}

export interface PhoneLinePatch {
  name?: string;
  active?: boolean;
  schedule?: unknown;
  greeting?: string | null;
}

type LineRow = typeof phoneLines.$inferSelect;

/** `bpl_<line>_<secret>`: the station's key, shown once (ADR-0232 #3, the print stations' scheme). */
const KEY_PATTERN = /^bpl_(\d{1,12})_([A-Za-z0-9_-]{20,100})$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newKey = (id: number) => `bpl_${id}_${randomBytes(24).toString('base64url')}`;

/**
 * The phone lines (ADR-0232 #2, #3). The office (`phone.lines.manage`) adds a line, sets its
 * working hours and greeting and switches it on; the station's key is kept as a sha-256 and shown
 * only when it is made or made again. A new line is off until someone switches it on, so it never
 * answers a call before its hours are set.
 */
@Injectable()
export class PhoneLinesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PhoneLine[]> {
    const rows = await this.db
      .select()
      .from(phoneLines)
      .orderBy(asc(phoneLines.name), asc(phoneLines.id));
    return rows.map(view);
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<PhoneLine> {
    const [row] = await executor.select().from(phoneLines).where(eq(phoneLines.id, id));
    if (!row) throw new PhoneError('PHONE_LINE_NOT_FOUND', `phone line ${id}`, { id });
    return view(row);
  }

  async create(ctx: AuthContext, input: PhoneLineInput): Promise<{ line: PhoneLine; key: string }> {
    const name = checkedName(input.name);
    const schedule =
      input.schedule === undefined ? emptySchedule() : checkedSchedule(input.schedule);
    const greeting = checkedGreeting(input.greeting ?? null);
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(phoneLines)
        // The hash is replaced below, once the id is known: it covers the whole key.
        .values({ name, schedule, greeting, keyHash: 'pending', createdBy: ctx.userId })
        .returning();
      if (!row) throw new Error('phone line not inserted');
      const key = newKey(row.id);
      const [saved] = await tx
        .update(phoneLines)
        .set({ keyHash: sha256(key) })
        .where(eq(phoneLines.id, row.id))
        .returning();
      if (!saved) throw new Error('phone line not updated');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'phone_lines',
        entityId: row.id,
        after: auditable(saved),
      });
      return { line: view(saved), key };
    });
  }

  async update(ctx: AuthContext, id: number, patch: PhoneLinePatch): Promise<PhoneLine> {
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(phoneLines)
        .where(eq(phoneLines.id, id))
        .for('update');
      if (!before) throw new PhoneError('PHONE_LINE_NOT_FOUND', `phone line ${id}`, { id });
      const changes: Partial<typeof phoneLines.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) changes.name = checkedName(patch.name);
      if (patch.active !== undefined) changes.active = patch.active;
      if (patch.schedule !== undefined) changes.schedule = checkedSchedule(patch.schedule);
      if (patch.greeting !== undefined) changes.greeting = checkedGreeting(patch.greeting);
      const [after] = await tx
        .update(phoneLines)
        .set(changes)
        .where(eq(phoneLines.id, id))
        .returning();
      if (!after) throw new Error('phone line not updated');
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'phone_lines',
        entityId: id,
        before: auditable(before),
        after: auditable(after),
      });
      return view(after);
    });
  }

  /** The station's new key; the old one stops working at once. */
  async rotateKey(ctx: AuthContext, id: number): Promise<{ line: PhoneLine; key: string }> {
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx.select().from(phoneLines).where(eq(phoneLines.id, id)).for('update');
      if (!row) throw new PhoneError('PHONE_LINE_NOT_FOUND', `phone line ${id}`, { id });
      const key = newKey(id);
      const [after] = await tx
        .update(phoneLines)
        .set({ keyHash: sha256(key), updatedAt: new Date() })
        .where(eq(phoneLines.id, id))
        .returning();
      if (!after) throw new Error('phone line not updated');
      await this.audit.record(tx, ctx, {
        action: 'TOKEN_ISSUED',
        entity: 'phone_lines',
        entityId: id,
      });
      return { line: view(after), key };
    });
  }

  /**
   * The line whose key this is, marked seen now; PHONE_KEY_INVALID otherwise. A line that is
   * switched off still authenticates (its station shows «унтраалттай» and its calls are declined):
   * the key is the door, `active` only decides whether the AI answers.
   */
  async authenticate(key: string): Promise<PhoneLine> {
    const presentedKey = key.trim();
    const match = KEY_PATTERN.exec(presentedKey);
    const refuse = () => new PhoneError('PHONE_KEY_INVALID', 'phone line key refused');
    if (!match?.[1]) throw refuse();
    const id = Number.parseInt(match[1], 10);
    const [row] = await this.db.select().from(phoneLines).where(eq(phoneLines.id, id));
    if (!row) throw refuse();
    const presented = Buffer.from(sha256(presentedKey), 'hex');
    const stored = Buffer.from(row.keyHash, 'hex');
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) throw refuse();
    const [seen] = await this.db
      .update(phoneLines)
      .set({ lastSeenAt: new Date() })
      .where(eq(phoneLines.id, id))
      .returning();
    return view(seen ?? row);
  }
}

/** Whether staff answer themselves at `at`: the AI stays silent then (ADR-0232 answer 5). */
export function staffAnswer(line: Pick<PhoneLine, 'schedule'>, at: Date): boolean {
  return isWorkingTime(line.schedule, at);
}

function checkedName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > PHONE_LIMITS.nameMax) {
    throw invalid('name', 'length', `1 to ${PHONE_LIMITS.nameMax} characters`);
  }
  return name;
}

function checkedGreeting(value: string | null): string | null {
  const greeting = value?.trim() ?? '';
  if (greeting.length === 0) return null;
  if (greeting.length > PHONE_LIMITS.greetingMax) {
    throw invalid('greeting', 'maxLength', `at most ${PHONE_LIMITS.greetingMax} characters`);
  }
  return greeting;
}

function checkedSchedule(value: unknown): PhoneSchedule {
  const issues = scheduleIssues(value);
  if (issues.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'the schedule is not valid',
      undefined,
      issues.map((issue) => ({
        path: issue.path,
        constraint: `schedule_${issue.code}`,
        message: `${issue.path}: ${issue.code}`,
      })),
    );
  }
  return normalizeSchedule(value);
}

/** The row without its key hash. */
function auditable(row: LineRow): Record<string, unknown> {
  const { keyHash: _hash, ...rest } = row;
  return rest;
}

export function view(row: LineRow): PhoneLine {
  const seen = row.lastSeenAt;
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    schedule: normalizeSchedule(row.schedule),
    greeting: row.greeting,
    lastSeenAt: seen,
    online: seen !== null && Date.now() - seen.getTime() < PHONE_LIMITS.onlineSeconds * 1000,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
