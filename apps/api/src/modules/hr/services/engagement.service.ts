import { Inject, Injectable } from '@nestjs/common';
import {
  type CalendarItemKind,
  ENGAGEMENT_LIMITS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackStatus,
  isEmployeeLeft,
  MESSAGE_KINDS,
  type MessageKind,
  POLL_KINDS,
  POLL_QUESTION_KINDS,
  type PollKind,
  type PollQuestionKind,
  yearsBetween,
} from '@tugeel/shared/hr';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  actorUserId,
  AuditService,
  type AuthContext,
  StorageService,
  UserNamesService,
} from '../../identity';
import {
  hrEvents,
  hrEventTypes,
  hrFeedback,
  hrLocationShares,
  hrMessageReads,
  hrMessageRecipients,
  hrMessages,
  hrMoods,
  hrPollAnswers,
  hrPollOptions,
  hrPollQuestions,
  hrPollRecipients,
  hrPolls,
  hrThanks,
} from '../schema';
import { ATTENDANCE_MANAGE } from './work-sites.service';
import { WorkforceService } from './workforce.service';

const IMAGE_KIND = 'hr.message_image';

const clean = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
};

function required(field: string, value: string, max: number): string {
  const text = value.trim();
  if (text === '') throw invalid(field, 'isNotEmpty', `${field} is required`);
  if ([...text].length > max) throw invalid(field, 'maxLength', `at most ${max}`);
  return text;
}

function optional(field: string, value: string | null | undefined, max: number): string | null {
  const text = clean(value);
  if (text !== null && [...text].length > max) throw invalid(field, 'maxLength', `at most ${max}`);
  return text;
}

function checkedRange(from: string, to: string): void {
  if (!isIsoDate(from)) throw invalid('from', 'isDate', 'YYYY-MM-DD');
  if (!isIsoDate(to)) throw invalid('to', 'isDate', 'YYYY-MM-DD');
  if (to < from) throw invalid('to', 'afterFrom', 'on or after from');
}

export interface MessageInput {
  kind: MessageKind;
  title: string;
  body: string;
  category?: string | null;
  imageFileId?: number | null;
  popup?: boolean;
  publishAt?: string | null;
  userIds?: readonly number[];
}

export interface MessageView {
  id: number;
  kind: MessageKind;
  title: string;
  body: string;
  category: string | null;
  imageUrl: string | null;
  popup: boolean;
  publishAt: Date;
  withdrawnAt: Date | null;
  createdByName: string;
  createdAt: Date;
  /** Everybody when empty. */
  userIds: number[];
  recipients: number;
  reads: number;
}

export interface MyMessage {
  id: number;
  kind: MessageKind;
  title: string;
  body: string;
  category: string | null;
  imageUrl: string | null;
  popup: boolean;
  publishAt: Date;
  read: boolean;
}

export interface PollQuestionInput {
  text: string;
  kind: PollQuestionKind;
  required?: boolean;
  options?: readonly string[];
}

export interface PollInput {
  kind: PollKind;
  title: string;
  note?: string | null;
  imageFileId?: number | null;
  showResults?: boolean;
  allowChange?: boolean;
  anonymous?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  userIds?: readonly number[];
  questions: readonly PollQuestionInput[];
}

export interface PollOptionView {
  id: number;
  text: string;
  count: number;
  /** Names who chose it; empty for an anonymous poll and for the staff. */
  voters: string[];
}

export interface PollQuestionView {
  id: number;
  text: string;
  kind: PollQuestionKind;
  required: boolean;
  options: PollOptionView[];
  /** The written answers (a TEXT question), unnamed. */
  texts: string[];
  /** The average of a SCALE question, one decimal; null before the first answer. */
  average: string | null;
  answered: number;
  /** What the signed-in person answered. */
  mine: { optionIds: number[]; text: string | null; value: number | null };
}

export interface PollView {
  id: number;
  kind: PollKind;
  title: string;
  note: string | null;
  imageUrl: string | null;
  showResults: boolean;
  allowChange: boolean;
  anonymous: boolean;
  startsAt: Date;
  endsAt: Date | null;
  closedAt: Date | null;
  open: boolean;
  createdByName: string;
  createdAt: Date;
  userIds: number[];
  recipients: number;
  respondents: number;
  answered: boolean;
  /** Whether the counts are in `questions` for this reader. */
  resultsShown: boolean;
  questions: PollQuestionView[];
}

export interface PollAnswerInput {
  questionId: number;
  optionIds?: readonly number[];
  text?: string | null;
  value?: number | null;
}

export interface EventTypeView {
  id: number;
  name: string;
  color: string;
  archivedAt: string | null;
  events: number;
}

export interface CalendarItem {
  date: string;
  kind: CalendarItemKind;
  title: string;
  note: string | null;
  /** HR's own entry; null for a birthday or an anniversary. */
  eventId: number | null;
  toDate: string | null;
  userId: number | null;
  photoUrl: string | null;
  /** The work anniversary's year count. */
  years: number | null;
  /** The type HR gave an event; null on a birthday and an anniversary (ADR-0171). */
  typeId: number | null;
  typeName: string | null;
  typeColor: string | null;
  doneAt: string | null;
  doneByName: string | null;
}

export interface FeedbackView {
  id: number;
  userId: number | null;
  fullName: string | null;
  category: FeedbackCategory;
  title: string;
  body: string;
  status: FeedbackStatus;
  reply: string | null;
  createdAt: Date;
}

export interface ThanksView {
  id: number;
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  toPhotoUrl: string | null;
  note: string;
  day: string;
  createdAt: Date;
}

export interface LocationShareView {
  id: number;
  userId: number;
  fullName: string;
  photoUrl: string | null;
  lat: string;
  lng: string;
  accuracyM: number | null;
  note: string | null;
  day: string;
  createdAt: Date;
}

/**
 * The staff's own side (ADR-0146, after timely.mn's home page): notices and news, votes and
 * surveys, the day's mood, feedback, thanks, a sent location and the month's calendar. Any staff
 * member reads and answers what is theirs; HR (`hr.attendance.manage`) writes and
 * `hr.attendance.view` reads the rest.
 */
@Injectable()
export class EngagementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly names: UserNamesService,
    private readonly workforce: WorkforceService,
  ) {}

  // ── notices and news ───────────────────────────────────────────────────────

  async createMessage(ctx: AuthContext, input: MessageInput): Promise<MessageView> {
    this.assertManage(ctx);
    if (!MESSAGE_KINDS.includes(input.kind)) {
      throw invalid('kind', 'enum', MESSAGE_KINDS.join(', '));
    }
    const title = required('title', input.title, ENGAGEMENT_LIMITS.maxTitle);
    const body = required('body', input.body, ENGAGEMENT_LIMITS.maxBody);
    const category = optional('category', input.category, ENGAGEMENT_LIMITS.maxCategory);
    const publishAt = this.moment('publishAt', input.publishAt);
    const imageFileId = input.imageFileId ?? null;
    if (imageFileId !== null) await this.storage.verifyUploaded(imageFileId, IMAGE_KIND);
    const userIds = [...new Set(input.userIds ?? [])];
    const id = await inTransaction(this.db, async (tx) => {
      if (imageFileId !== null) await this.storage.confirm(tx, imageFileId, IMAGE_KIND);
      const [row] = await tx
        .insert(hrMessages)
        .values({
          kind: input.kind,
          title,
          body,
          category,
          imageFileId,
          popup: input.popup ?? input.kind === 'NOTICE',
          publishAt: publishAt ?? sql`now()`,
          createdBy: actorUserId(ctx) ?? ctx.userId,
        })
        .returning({ id: hrMessages.id });
      if (!row) throw new Error('message insert returned no row');
      if (userIds.length > 0) {
        await tx
          .insert(hrMessageRecipients)
          .values(userIds.map((userId) => ({ messageId: row.id, userId })));
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'hr_message',
        entityId: row.id,
        after: { kind: input.kind, title, recipients: userIds.length },
      });
      return row.id;
    });
    return this.message(id);
  }

  async messages(query: { kind?: MessageKind }): Promise<MessageView[]> {
    const rows = await this.db
      .select()
      .from(hrMessages)
      .where(query.kind ? eq(hrMessages.kind, query.kind) : undefined)
      .orderBy(desc(hrMessages.publishAt), desc(hrMessages.id))
      .limit(500);
    return this.messageViews(rows);
  }

  async withdrawMessage(ctx: AuthContext, id: number): Promise<MessageView> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      const rows = await tx
        .update(hrMessages)
        .set({ withdrawnAt: sql`coalesce(${hrMessages.withdrawnAt}, now())` })
        .where(eq(hrMessages.id, id))
        .returning({ id: hrMessages.id });
      if (rows.length === 0) throw notFound('hr_message', id);
      await this.audit.record(tx, ctx, {
        action: 'WITHDRAW',
        entity: 'hr_message',
        entityId: id,
      });
    });
    return this.message(id);
  }

  /** What has reached this person, newest first: published, not withdrawn, for them. */
  async myMessages(ctx: AuthContext, kind?: MessageKind): Promise<MyMessage[]> {
    const rows = await this.db
      .select({ message: hrMessages, readAt: hrMessageReads.readAt })
      .from(hrMessages)
      .leftJoin(
        hrMessageReads,
        and(eq(hrMessageReads.messageId, hrMessages.id), eq(hrMessageReads.userId, ctx.userId)),
      )
      .where(
        and(
          kind ? eq(hrMessages.kind, kind) : undefined,
          isNull(hrMessages.withdrawnAt),
          lte(hrMessages.publishAt, sql`now()`),
          sql`(NOT EXISTS (SELECT 1 FROM hr_message_recipients r WHERE r.message_id = ${hrMessages.id})
               OR EXISTS (SELECT 1 FROM hr_message_recipients r
                           WHERE r.message_id = ${hrMessages.id} AND r.user_id = ${ctx.userId}))`,
        ),
      )
      .orderBy(desc(hrMessages.publishAt), desc(hrMessages.id))
      .limit(200);
    const images = await this.storage.publicUrls(
      rows.flatMap((row) => (row.message.imageFileId === null ? [] : [row.message.imageFileId])),
    );
    return rows.map(({ message, readAt }) => ({
      id: message.id,
      kind: message.kind,
      title: message.title,
      body: message.body,
      category: message.category,
      imageUrl: message.imageFileId === null ? null : (images.get(message.imageFileId) ?? null),
      popup: message.popup,
      publishAt: message.publishAt,
      read: readAt !== null,
    }));
  }

  async readMessages(ctx: AuthContext, ids: readonly number[]): Promise<void> {
    const reachable = new Set((await this.myMessages(ctx)).map((message) => message.id));
    const values = [...new Set(ids)]
      .filter((id) => reachable.has(id))
      .map((messageId) => ({ messageId, userId: ctx.userId }));
    if (values.length > 0)
      await this.db.insert(hrMessageReads).values(values).onConflictDoNothing();
  }

  private async message(id: number): Promise<MessageView> {
    const rows = await this.db.select().from(hrMessages).where(eq(hrMessages.id, id));
    const [view] = await this.messageViews(rows);
    if (!view) throw notFound('hr_message', id);
    return view;
  }

  private async messageViews(rows: readonly (typeof hrMessages.$inferSelect)[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [recipients, reads, names, images, staff] = await Promise.all([
      this.db.select().from(hrMessageRecipients).where(inArray(hrMessageRecipients.messageId, ids)),
      this.db
        .select({ messageId: hrMessageReads.messageId, count: count() })
        .from(hrMessageReads)
        .where(inArray(hrMessageReads.messageId, ids))
        .groupBy(hrMessageReads.messageId),
      this.names.namesOf(rows.map((row) => row.createdBy)),
      this.storage.publicUrls(
        rows.flatMap((row) => (row.imageFileId === null ? [] : [row.imageFileId])),
      ),
      this.activeCount(),
    ]);
    const readCount = new Map(reads.map((row) => [row.messageId, row.count]));
    return rows.map((row): MessageView => {
      const userIds = recipients
        .filter((entry) => entry.messageId === row.id)
        .map((entry) => entry.userId);
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        category: row.category,
        imageUrl: row.imageFileId === null ? null : (images.get(row.imageFileId) ?? null),
        popup: row.popup,
        publishAt: row.publishAt,
        withdrawnAt: row.withdrawnAt,
        createdByName: names.get(row.createdBy) ?? '',
        createdAt: row.createdAt,
        userIds,
        recipients: userIds.length > 0 ? userIds.length : staff,
        reads: readCount.get(row.id) ?? 0,
      };
    });
  }

  // ── votes and surveys ──────────────────────────────────────────────────────

  async createPoll(ctx: AuthContext, input: PollInput): Promise<PollView> {
    this.assertManage(ctx);
    if (!POLL_KINDS.includes(input.kind)) throw invalid('kind', 'enum', POLL_KINDS.join(', '));
    const title = required('title', input.title, ENGAGEMENT_LIMITS.maxTitle);
    const note = optional('note', input.note, ENGAGEMENT_LIMITS.maxNote);
    const startsAt = this.moment('startsAt', input.startsAt);
    const endsAt = this.moment('endsAt', input.endsAt);
    if (endsAt && endsAt <= (startsAt ?? new Date())) {
      throw invalid('endsAt', 'afterStart', 'the end must be after the start');
    }
    const questions = this.checkedQuestions(input);
    const imageFileId = input.imageFileId ?? null;
    if (imageFileId !== null) await this.storage.verifyUploaded(imageFileId, IMAGE_KIND);
    const userIds = [...new Set(input.userIds ?? [])];
    const id = await inTransaction(this.db, async (tx) => {
      if (imageFileId !== null) await this.storage.confirm(tx, imageFileId, IMAGE_KIND);
      const [poll] = await tx
        .insert(hrPolls)
        .values({
          kind: input.kind,
          title,
          note,
          imageFileId,
          showResults: input.showResults ?? false,
          allowChange: input.allowChange ?? false,
          anonymous: input.anonymous ?? false,
          startsAt: startsAt ?? sql`now()`,
          endsAt,
          createdBy: actorUserId(ctx) ?? ctx.userId,
        })
        .returning({ id: hrPolls.id });
      if (!poll) throw new Error('poll insert returned no row');
      if (userIds.length > 0) {
        await tx
          .insert(hrPollRecipients)
          .values(userIds.map((userId) => ({ pollId: poll.id, userId })));
      }
      for (const [sort, question] of questions.entries()) {
        const [row] = await tx
          .insert(hrPollQuestions)
          .values({
            pollId: poll.id,
            sort,
            text: question.text,
            kind: question.kind,
            required: question.required,
          })
          .returning({ id: hrPollQuestions.id });
        if (!row) throw new Error('question insert returned no row');
        if (question.options.length > 0) {
          await tx
            .insert(hrPollOptions)
            .values(
              question.options.map((text, index) => ({ questionId: row.id, sort: index, text })),
            );
        }
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'hr_poll',
        entityId: poll.id,
        after: { kind: input.kind, title, questions: questions.length },
      });
      return poll.id;
    });
    return this.poll(ctx, id, true);
  }

  /** HR's list: every poll with its counts. */
  async polls(ctx: AuthContext, kind?: PollKind): Promise<PollView[]> {
    const rows = await this.db
      .select()
      .from(hrPolls)
      .where(kind ? eq(hrPolls.kind, kind) : undefined)
      .orderBy(desc(hrPolls.startsAt), desc(hrPolls.id))
      .limit(200);
    return this.pollViews(ctx, rows, true);
  }

  async closePoll(ctx: AuthContext, id: number): Promise<PollView> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      const rows = await tx
        .update(hrPolls)
        .set({ closedAt: sql`coalesce(${hrPolls.closedAt}, now())` })
        .where(eq(hrPolls.id, id))
        .returning({ id: hrPolls.id });
      if (rows.length === 0) throw notFound('hr_poll', id);
      await this.audit.record(tx, ctx, { action: 'CLOSE', entity: 'hr_poll', entityId: id });
    });
    return this.poll(ctx, id, true);
  }

  /** The polls that have reached this person: open ones first, closed ones they took part in. */
  async myPolls(ctx: AuthContext): Promise<PollView[]> {
    const rows = await this.db
      .select()
      .from(hrPolls)
      .where(
        and(
          lte(hrPolls.startsAt, sql`now()`),
          sql`(NOT EXISTS (SELECT 1 FROM hr_poll_recipients r WHERE r.poll_id = ${hrPolls.id})
               OR EXISTS (SELECT 1 FROM hr_poll_recipients r
                           WHERE r.poll_id = ${hrPolls.id} AND r.user_id = ${ctx.userId}))`,
        ),
      )
      .orderBy(desc(hrPolls.startsAt), desc(hrPolls.id))
      .limit(100);
    const views = await this.pollViews(ctx, rows, false);
    return views
      .filter((poll) => poll.open || poll.answered)
      .sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0));
  }

  /** Answers a poll in one go; a repeat replaces them only when the poll allows it. */
  async answerPoll(
    ctx: AuthContext,
    id: number,
    answers: readonly PollAnswerInput[],
  ): Promise<PollView> {
    await inTransaction(this.db, async (tx) => {
      const [poll] = await tx.select().from(hrPolls).where(eq(hrPolls.id, id));
      if (!poll) throw notFound('hr_poll', id);
      if (!this.isOpen(poll)) throw new AppError('HR_POLL_CLOSED', `poll ${id} is closed`, { id });
      const recipients = await tx
        .select({ userId: hrPollRecipients.userId })
        .from(hrPollRecipients)
        .where(eq(hrPollRecipients.pollId, id));
      if (recipients.length > 0 && !recipients.some((row) => row.userId === ctx.userId)) {
        throw notFound('hr_poll', id);
      }
      const [already] = await tx
        .select({ id: hrPollAnswers.id })
        .from(hrPollAnswers)
        .where(and(eq(hrPollAnswers.pollId, id), eq(hrPollAnswers.userId, ctx.userId)))
        .limit(1);
      if (already && !poll.allowChange) {
        throw new AppError('HR_POLL_ANSWERED', `poll ${id} was answered`, { id });
      }
      const rows = await this.checkedAnswers(tx, id, ctx.userId, answers);
      if (already) {
        await tx
          .delete(hrPollAnswers)
          .where(and(eq(hrPollAnswers.pollId, id), eq(hrPollAnswers.userId, ctx.userId)));
      }
      if (rows.length > 0) await tx.insert(hrPollAnswers).values(rows);
    });
    return this.poll(ctx, id, false);
  }

  private async checkedAnswers(
    tx: Tx,
    pollId: number,
    userId: number,
    answers: readonly PollAnswerInput[],
  ): Promise<(typeof hrPollAnswers.$inferInsert)[]> {
    const questions = await tx
      .select()
      .from(hrPollQuestions)
      .where(eq(hrPollQuestions.pollId, pollId));
    const options = await tx
      .select({ id: hrPollOptions.id, questionId: hrPollOptions.questionId })
      .from(hrPollOptions)
      .where(
        inArray(
          hrPollOptions.questionId,
          questions.map((question) => question.id),
        ),
      );
    const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
    for (const answer of answers) {
      if (!questions.some((question) => question.id === answer.questionId)) {
        throw invalid('answers', 'question', `question ${answer.questionId} is not in the poll`);
      }
    }
    const rows: (typeof hrPollAnswers.$inferInsert)[] = [];
    for (const question of questions) {
      const answer = byQuestion.get(question.id);
      const base = { pollId, questionId: question.id, userId };
      const missing = () => {
        if (question.required) {
          throw invalid('answers', 'required', `question ${question.id} needs an answer`);
        }
      };
      if (question.kind === 'TEXT') {
        const text = optional('text', answer?.text, ENGAGEMENT_LIMITS.maxAnswerText);
        if (text === null) missing();
        else rows.push({ ...base, text });
      } else if (question.kind === 'SCALE') {
        const value = answer?.value ?? null;
        if (value === null) missing();
        else if (!Number.isInteger(value) || value < 1 || value > ENGAGEMENT_LIMITS.scaleMax) {
          throw invalid('value', 'range', `1 to ${ENGAGEMENT_LIMITS.scaleMax}`);
        } else rows.push({ ...base, value });
      } else {
        const chosen = [...new Set(answer?.optionIds ?? [])];
        if (chosen.length === 0) missing();
        if (question.kind === 'SINGLE' && chosen.length > 1) {
          throw invalid('optionIds', 'single', 'one option only');
        }
        for (const optionId of chosen) {
          if (!options.some((row) => row.id === optionId && row.questionId === question.id)) {
            throw invalid('optionIds', 'option', `option ${optionId} is not in the question`);
          }
          rows.push({ ...base, optionId });
        }
      }
    }
    return rows;
  }

  private checkedQuestions(input: PollInput) {
    if (input.questions.length === 0) throw invalid('questions', 'arrayMinSize', 'a question');
    if (input.questions.length > ENGAGEMENT_LIMITS.maxQuestions) {
      throw invalid('questions', 'arrayMaxSize', `at most ${ENGAGEMENT_LIMITS.maxQuestions}`);
    }
    if (input.kind === 'VOTE' && input.questions.length !== 1) {
      throw invalid('questions', 'vote', 'a vote has one question');
    }
    return input.questions.map((question) => {
      if (!POLL_QUESTION_KINDS.includes(question.kind)) {
        throw invalid('kind', 'enum', POLL_QUESTION_KINDS.join(', '));
      }
      const hasOptions = question.kind === 'SINGLE' || question.kind === 'MULTI';
      const options = hasOptions
        ? (question.options ?? []).map((text) =>
            required('options', text, ENGAGEMENT_LIMITS.maxOptionText),
          )
        : [];
      if (
        hasOptions &&
        (options.length < ENGAGEMENT_LIMITS.minOptions ||
          options.length > ENGAGEMENT_LIMITS.maxOptions)
      ) {
        throw invalid(
          'options',
          'count',
          `${ENGAGEMENT_LIMITS.minOptions} to ${ENGAGEMENT_LIMITS.maxOptions} options`,
        );
      }
      return {
        text: required('text', question.text, ENGAGEMENT_LIMITS.maxTitle * 2),
        kind: question.kind,
        required: question.required ?? true,
        options,
      };
    });
  }

  private isOpen(poll: typeof hrPolls.$inferSelect, now = new Date()): boolean {
    return (
      poll.closedAt === null && poll.startsAt <= now && (poll.endsAt === null || poll.endsAt > now)
    );
  }

  private async poll(ctx: AuthContext, id: number, asHr: boolean): Promise<PollView> {
    const rows = await this.db.select().from(hrPolls).where(eq(hrPolls.id, id));
    const [view] = await this.pollViews(ctx, rows, asHr);
    if (!view) throw notFound('hr_poll', id);
    return view;
  }

  /** `asHr`: always the counts, and the voters' names unless anonymous. */
  private async pollViews(
    ctx: AuthContext,
    rows: readonly (typeof hrPolls.$inferSelect)[],
    asHr: boolean,
  ): Promise<PollView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [recipients, questions, answers, images, staff] = await Promise.all([
      this.db.select().from(hrPollRecipients).where(inArray(hrPollRecipients.pollId, ids)),
      this.db
        .select()
        .from(hrPollQuestions)
        .where(inArray(hrPollQuestions.pollId, ids))
        .orderBy(asc(hrPollQuestions.sort), asc(hrPollQuestions.id)),
      this.db.select().from(hrPollAnswers).where(inArray(hrPollAnswers.pollId, ids)),
      this.storage.publicUrls(
        rows.flatMap((row) => (row.imageFileId === null ? [] : [row.imageFileId])),
      ),
      this.activeCount(),
    ]);
    const options =
      questions.length === 0
        ? []
        : await this.db
            .select()
            .from(hrPollOptions)
            .where(
              inArray(
                hrPollOptions.questionId,
                questions.map((question) => question.id),
              ),
            )
            .orderBy(asc(hrPollOptions.sort), asc(hrPollOptions.id));
    const names = await this.names.namesOf([
      ...rows.map((row) => row.createdBy),
      ...(asHr ? answers.map((answer) => answer.userId) : []),
    ]);
    return rows.map((poll): PollView => {
      const mine = answers.filter((row) => row.pollId === poll.id);
      const respondents = new Set(mine.map((row) => row.userId));
      const answered = respondents.has(ctx.userId);
      const open = this.isOpen(poll);
      const resultsShown = asHr || (answered && poll.showResults) || (!open && poll.showResults);
      const userIds = recipients.filter((row) => row.pollId === poll.id).map((row) => row.userId);
      return {
        id: poll.id,
        kind: poll.kind,
        title: poll.title,
        note: poll.note,
        imageUrl: poll.imageFileId === null ? null : (images.get(poll.imageFileId) ?? null),
        showResults: poll.showResults,
        allowChange: poll.allowChange,
        anonymous: poll.anonymous,
        startsAt: poll.startsAt,
        endsAt: poll.endsAt,
        closedAt: poll.closedAt,
        open,
        createdByName: names.get(poll.createdBy) ?? '',
        createdAt: poll.createdAt,
        userIds,
        recipients: userIds.length > 0 ? userIds.length : staff,
        respondents: respondents.size,
        answered,
        resultsShown,
        questions: questions
          .filter((question) => question.pollId === poll.id)
          .map((question) => {
            const given = mine.filter((row) => row.questionId === question.id);
            const own = given.filter((row) => row.userId === ctx.userId);
            const values = given.flatMap((row) => (row.value === null ? [] : [row.value]));
            const average =
              resultsShown && values.length > 0
                ? values
                    .reduce((sum, value) => sum.plus(value), new Decimal(0))
                    .div(values.length)
                    .toFixed(1)
                : null;
            return {
              id: question.id,
              text: question.text,
              kind: question.kind,
              required: question.required,
              answered: resultsShown ? new Set(given.map((row) => row.userId)).size : 0,
              average,
              texts: resultsShown
                ? given.flatMap((row) => (row.text === null ? [] : [row.text]))
                : [],
              mine: {
                optionIds: own.flatMap((row) => (row.optionId === null ? [] : [row.optionId])),
                text: own.find((row) => row.text !== null)?.text ?? null,
                value: own.find((row) => row.value !== null)?.value ?? null,
              },
              options: options
                .filter((option) => option.questionId === question.id)
                .map((option) => {
                  const chose = given.filter((row) => row.optionId === option.id);
                  return {
                    id: option.id,
                    text: option.text,
                    count: resultsShown ? chose.length : 0,
                    voters:
                      asHr && !poll.anonymous
                        ? chose.map((row) => names.get(row.userId) ?? '')
                        : [],
                  };
                }),
            };
          }),
      };
    });
  }

  // ── the day's mood ─────────────────────────────────────────────────────────

  async setMood(ctx: AuthContext, score: number): Promise<{ day: string; score: number }> {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw invalid('score', 'range', '1 to 5');
    }
    const day = businessDate();
    await this.db
      .insert(hrMoods)
      .values({ userId: ctx.userId, day, score })
      .onConflictDoUpdate({
        target: [hrMoods.userId, hrMoods.day],
        set: { score, updatedAt: sql`now()` },
      });
    return { day, score };
  }

  async myMood(ctx: AuthContext): Promise<number | null> {
    const [row] = await this.db
      .select({ score: hrMoods.score })
      .from(hrMoods)
      .where(and(eq(hrMoods.userId, ctx.userId), eq(hrMoods.day, businessDate())));
    return row?.score ?? null;
  }

  /** Only the counts per face: HR never sees whose face it was. */
  async moods(query: {
    from: string;
    to: string;
  }): Promise<{ scores: { score: number; count: number }[]; total: number }> {
    checkedRange(query.from, query.to);
    const rows = await this.db
      .select({ score: hrMoods.score, count: count() })
      .from(hrMoods)
      .where(and(gte(hrMoods.day, query.from), lte(hrMoods.day, query.to)))
      .groupBy(hrMoods.score);
    const counted = new Map(rows.map((row) => [row.score, row.count]));
    const scores = [1, 2, 3, 4, 5].map((score) => ({ score, count: counted.get(score) ?? 0 }));
    return { scores, total: scores.reduce((sum, row) => sum + row.count, 0) };
  }

  // ── feedback ───────────────────────────────────────────────────────────────

  async sendFeedback(
    ctx: AuthContext,
    input: { category: FeedbackCategory; title: string; body: string; anonymous?: boolean },
  ): Promise<FeedbackView> {
    if (!FEEDBACK_CATEGORIES.includes(input.category)) {
      throw invalid('category', 'enum', FEEDBACK_CATEGORIES.join(', '));
    }
    const [row] = await this.db
      .insert(hrFeedback)
      .values({
        userId: input.anonymous ? null : ctx.userId,
        category: input.category,
        title: required('title', input.title, ENGAGEMENT_LIMITS.maxTitle),
        body: required('body', input.body, ENGAGEMENT_LIMITS.maxBody),
      })
      .returning();
    if (!row) throw new Error('feedback insert returned no row');
    return (await this.feedbackViews([row]))[0] as FeedbackView;
  }

  /** What the person sent under their name. */
  async myFeedback(ctx: AuthContext): Promise<FeedbackView[]> {
    const rows = await this.db
      .select()
      .from(hrFeedback)
      .where(eq(hrFeedback.userId, ctx.userId))
      .orderBy(desc(hrFeedback.createdAt))
      .limit(100);
    return this.feedbackViews(rows);
  }

  async feedback(query: {
    from?: string;
    to?: string;
    status?: FeedbackStatus;
    category?: FeedbackCategory;
  }): Promise<FeedbackView[]> {
    const rows = await this.db
      .select()
      .from(hrFeedback)
      .where(
        and(
          query.from ? gte(sql`${hrFeedback.createdAt}::date`, query.from) : undefined,
          query.to ? lte(sql`${hrFeedback.createdAt}::date`, query.to) : undefined,
          query.status ? eq(hrFeedback.status, query.status) : undefined,
          query.category ? eq(hrFeedback.category, query.category) : undefined,
        ),
      )
      .orderBy(desc(hrFeedback.createdAt))
      .limit(500);
    return this.feedbackViews(rows);
  }

  async decideFeedback(
    ctx: AuthContext,
    id: number,
    input: { status: FeedbackStatus; reply?: string | null },
  ): Promise<FeedbackView> {
    this.assertManage(ctx);
    if (!FEEDBACK_STATUSES.includes(input.status)) {
      throw invalid('status', 'enum', FEEDBACK_STATUSES.join(', '));
    }
    const reply = optional('reply', input.reply, ENGAGEMENT_LIMITS.maxBody);
    const row = await inTransaction(this.db, async (tx) => {
      const [saved] = await tx
        .update(hrFeedback)
        .set({
          status: input.status,
          reply,
          repliedBy: reply === null ? null : (actorUserId(ctx) ?? ctx.userId),
          updatedAt: sql`now()`,
        })
        .where(eq(hrFeedback.id, id))
        .returning();
      if (!saved) throw notFound('hr_feedback', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_feedback',
        entityId: id,
        after: { status: input.status, replied: reply !== null },
      });
      return saved;
    });
    return (await this.feedbackViews([row]))[0] as FeedbackView;
  }

  private async feedbackViews(rows: readonly (typeof hrFeedback.$inferSelect)[]) {
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.userId === null ? [] : [row.userId])),
    );
    return rows.map((row): FeedbackView => ({
      id: row.id,
      userId: row.userId,
      fullName: row.userId === null ? null : (names.get(row.userId) ?? null),
      category: row.category,
      title: row.title,
      body: row.body,
      status: row.status,
      reply: row.reply,
      createdAt: row.createdAt,
    }));
  }

  // ── thanks ─────────────────────────────────────────────────────────────────

  async sendThanks(
    ctx: AuthContext,
    input: { toUserId: number; note: string },
  ): Promise<ThanksView> {
    if (input.toUserId === ctx.userId) throw invalid('toUserId', 'notSelf', 'not to oneself');
    const note = required('note', input.note, ENGAGEMENT_LIMITS.maxNote);
    const known = await this.names.namesOf([input.toUserId]);
    if (!known.has(input.toUserId)) throw notFound('user', input.toUserId);
    const [row] = await this.db
      .insert(hrThanks)
      .values({ fromUserId: ctx.userId, toUserId: input.toUserId, note, day: businessDate() })
      .returning();
    if (!row) throw new Error('thanks insert returned no row');
    return (await this.thanksViews([row]))[0] as ThanksView;
  }

  /** The range's thanks, newest first, and who received most; open to every staff member. */
  async thanks(query: { from: string; to: string }): Promise<{
    items: ThanksView[];
    ranking: { userId: number; fullName: string; photoUrl: string | null; count: number }[];
  }> {
    checkedRange(query.from, query.to);
    const rows = await this.db
      .select()
      .from(hrThanks)
      .where(and(gte(hrThanks.day, query.from), lte(hrThanks.day, query.to)))
      .orderBy(desc(hrThanks.createdAt))
      .limit(500);
    const items = await this.thanksViews(rows);
    const ranked = new Map<number, { fullName: string; photoUrl: string | null; count: number }>();
    for (const item of items) {
      const entry = ranked.get(item.toUserId);
      if (entry) entry.count += 1;
      else {
        ranked.set(item.toUserId, {
          fullName: item.toName,
          photoUrl: item.toPhotoUrl,
          count: 1,
        });
      }
    }
    return {
      items,
      ranking: [...ranked.entries()]
        .map(([userId, entry]) => ({ userId, ...entry }))
        .sort((a, b) => b.count - a.count || a.fullName.localeCompare(b.fullName, 'mn'))
        .slice(0, 10),
    };
  }

  private async thanksViews(rows: readonly (typeof hrThanks.$inferSelect)[]) {
    const photos = await this.photosOf();
    const names = await this.names.namesOf(rows.flatMap((row) => [row.fromUserId, row.toUserId]));
    return rows.map((row): ThanksView => ({
      id: row.id,
      fromUserId: row.fromUserId,
      fromName: names.get(row.fromUserId) ?? '',
      toUserId: row.toUserId,
      toName: names.get(row.toUserId) ?? '',
      toPhotoUrl: photos.get(row.toUserId) ?? null,
      note: row.note,
      day: row.day,
      createdAt: row.createdAt,
    }));
  }

  // ── a sent location ────────────────────────────────────────────────────────

  async shareLocation(
    ctx: AuthContext,
    input: { lat: string; lng: string; accuracyM?: number | null; note?: string | null },
  ): Promise<LocationShareView> {
    const [row] = await this.db
      .insert(hrLocationShares)
      .values({
        userId: ctx.userId,
        lat: new Decimal(input.lat),
        lng: new Decimal(input.lng),
        accuracyM: input.accuracyM ?? null,
        note: optional('note', input.note, ENGAGEMENT_LIMITS.maxNote),
        day: businessDate(),
      })
      .returning();
    if (!row) throw new Error('location insert returned no row');
    return (await this.shareViews([row]))[0] as LocationShareView;
  }

  async myLocations(ctx: AuthContext): Promise<LocationShareView[]> {
    const rows = await this.db
      .select()
      .from(hrLocationShares)
      .where(eq(hrLocationShares.userId, ctx.userId))
      .orderBy(desc(hrLocationShares.createdAt))
      .limit(50);
    return this.shareViews(rows);
  }

  async locations(query: {
    from: string;
    to: string;
    userId?: number;
  }): Promise<LocationShareView[]> {
    checkedRange(query.from, query.to);
    const rows = await this.db
      .select()
      .from(hrLocationShares)
      .where(
        and(
          gte(hrLocationShares.day, query.from),
          lte(hrLocationShares.day, query.to),
          query.userId === undefined ? undefined : eq(hrLocationShares.userId, query.userId),
        ),
      )
      .orderBy(desc(hrLocationShares.createdAt))
      .limit(1000);
    return this.shareViews(rows);
  }

  private async shareViews(rows: readonly (typeof hrLocationShares.$inferSelect)[]) {
    const photos = await this.photosOf();
    const names = await this.names.namesOf(rows.map((row) => row.userId));
    return rows.map((row): LocationShareView => ({
      id: row.id,
      userId: row.userId,
      fullName: names.get(row.userId) ?? '',
      photoUrl: photos.get(row.userId) ?? null,
      lat: row.lat.toString(),
      lng: row.lng.toString(),
      accuracyM: row.accuracyM,
      note: row.note,
      day: row.day,
      createdAt: row.createdAt,
    }));
  }

  // ── the calendar ───────────────────────────────────────────────────────────

  async saveEvent(
    ctx: AuthContext,
    id: number | null,
    input: {
      typeId: number;
      title: string;
      note?: string | null;
      fromDate: string;
      toDate?: string | null;
    },
  ): Promise<CalendarItem> {
    this.assertManage(ctx);
    const title = required('title', input.title, ENGAGEMENT_LIMITS.maxTitle);
    const note = optional('note', input.note, ENGAGEMENT_LIMITS.maxNote);
    const toDate = input.toDate ?? input.fromDate;
    checkedRange(input.fromDate, toDate);
    const values = { typeId: input.typeId, title, note, fromDate: input.fromDate, toDate };
    const names = await this.staffNames();
    return inTransaction(this.db, async (tx) => {
      const [type] = await tx.select().from(hrEventTypes).where(eq(hrEventTypes.id, input.typeId));
      if (!type) throw invalid('typeId', 'exists', 'a calendar type');
      // An archived type stays on the events it holds, and takes no more.
      if (type.archivedAt) {
        const [held] =
          id === null
            ? []
            : await tx
                .select({ typeId: hrEvents.typeId })
                .from(hrEvents)
                .where(eq(hrEvents.id, id));
        if (held?.typeId !== type.id) throw invalid('typeId', 'active', 'an active calendar type');
      }
      const [row] =
        id === null
          ? await tx
              .insert(hrEvents)
              .values({ ...values, createdBy: actorUserId(ctx) ?? ctx.userId })
              .returning()
          : await tx.update(hrEvents).set(values).where(eq(hrEvents.id, id)).returning();
      if (!row) throw notFound('hr_event', id ?? 0);
      await this.audit.record(tx, ctx, {
        action: id === null ? 'CREATE' : 'UPDATE',
        entity: 'hr_event',
        entityId: row.id,
        after: values,
      });
      return this.eventItem(row, type, names);
    });
  }

  /** Marks an event's work done or not; asking for what already stands changes nothing. */
  async setEventDone(ctx: AuthContext, id: number, done: boolean): Promise<CalendarItem> {
    const names = await this.staffNames();
    return inTransaction(this.db, async (tx) => {
      const changed = await tx
        .update(hrEvents)
        .set(
          done
            ? { doneAt: sql`now()`, doneBy: actorUserId(ctx) ?? ctx.userId }
            : { doneAt: null, doneBy: null },
        )
        .where(
          and(
            eq(hrEvents.id, id),
            isNull(hrEvents.archivedAt),
            done ? isNull(hrEvents.doneAt) : isNotNull(hrEvents.doneAt),
          ),
        )
        .returning({ id: hrEvents.id });
      if (changed.length > 0) {
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'hr_event',
          entityId: id,
          after: { done },
        });
      }
      const [found] = await tx
        .select({ event: hrEvents, type: hrEventTypes })
        .from(hrEvents)
        .innerJoin(hrEventTypes, eq(hrEventTypes.id, hrEvents.typeId))
        .where(and(eq(hrEvents.id, id), isNull(hrEvents.archivedAt)));
      if (!found) throw notFound('hr_event', id);
      return this.eventItem(found.event, found.type, names);
    });
  }

  // ── the calendar's types (ADR-0171) ────────────────────────────────────────

  async eventTypes(includeArchived: boolean): Promise<EventTypeView[]> {
    const rows = await this.db
      .select({
        id: hrEventTypes.id,
        name: hrEventTypes.name,
        color: hrEventTypes.color,
        archivedAt: hrEventTypes.archivedAt,
        events: sql<string>`count(${hrEvents.id})`,
      })
      .from(hrEventTypes)
      .leftJoin(hrEvents, and(eq(hrEvents.typeId, hrEventTypes.id), isNull(hrEvents.archivedAt)))
      .where(includeArchived ? undefined : isNull(hrEventTypes.archivedAt))
      .groupBy(hrEventTypes.id)
      .orderBy(asc(hrEventTypes.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      events: Number.parseInt(row.events, 10),
    }));
  }

  async saveEventType(
    ctx: AuthContext,
    id: number | null,
    input: { name: string; color: string },
  ): Promise<EventTypeView> {
    this.assertManage(ctx);
    const name = required('name', input.name, ENGAGEMENT_LIMITS.maxEventTypeName);
    if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) throw invalid('color', 'pattern', '#rrggbb');
    const savedId = await inTransaction(this.db, async (tx) => {
      const [taken] = await tx
        .select({ id: hrEventTypes.id })
        .from(hrEventTypes)
        .where(sql`lower(${hrEventTypes.name}) = lower(${name})`);
      if (taken && taken.id !== id) {
        throw new AppError('DUPLICATE_VALUE', 'a type of that name exists', { field: 'name' });
      }
      const values = { name, color: input.color };
      const [row] =
        id === null
          ? await tx.insert(hrEventTypes).values(values).returning({ id: hrEventTypes.id })
          : await tx
              .update(hrEventTypes)
              .set({ ...values, updatedAt: sql`now()` })
              .where(eq(hrEventTypes.id, id))
              .returning({ id: hrEventTypes.id });
      if (!row) throw notFound('hr_event_type', id ?? 0);
      await this.audit.record(tx, ctx, {
        action: id === null ? 'CREATE' : 'UPDATE',
        entity: 'hr_event_type',
        entityId: row.id,
        after: values,
      });
      return row.id;
    });
    return this.eventTypeView(savedId);
  }

  async setEventTypeArchived(
    ctx: AuthContext,
    id: number,
    archived: boolean,
  ): Promise<EventTypeView> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      const rows = await tx
        .update(hrEventTypes)
        .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
        .where(eq(hrEventTypes.id, id))
        .returning({ id: hrEventTypes.id });
      if (rows.length === 0) throw notFound('hr_event_type', id);
      await this.audit.record(tx, ctx, {
        action: archived ? 'ARCHIVE' : 'RESTORE',
        entity: 'hr_event_type',
        entityId: id,
      });
    });
    return this.eventTypeView(id);
  }

  private async eventTypeView(id: number): Promise<EventTypeView> {
    const view = (await this.eventTypes(true)).find((row) => row.id === id);
    if (!view) throw notFound('hr_event_type', id);
    return view;
  }

  async archiveEvent(ctx: AuthContext, id: number): Promise<void> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      const rows = await tx
        .update(hrEvents)
        .set({ archivedAt: sql`now()` })
        .where(eq(hrEvents.id, id))
        .returning({ id: hrEvents.id });
      if (rows.length === 0) throw notFound('hr_event', id);
      await this.audit.record(tx, ctx, { action: 'ARCHIVE', entity: 'hr_event', entityId: id });
    });
  }

  /**
   * «Энэ сарын үйл явдлууд» for `YYYY-MM`, open to every staff member: HR's events, and for those
   * still employed the birthday (the day, never the year or the age) and the work anniversary.
   */
  async calendar(month: string): Promise<CalendarItem[]> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('month', 'isMonth', 'YYYY-MM');
    const first = `${month}-01`;
    const last = addDays(addMonth(first), -1);
    const [events, staff] = await Promise.all([
      this.db
        .select({ event: hrEvents, type: hrEventTypes })
        .from(hrEvents)
        .innerJoin(hrEventTypes, eq(hrEventTypes.id, hrEvents.typeId))
        .where(
          and(
            isNull(hrEvents.archivedAt),
            lte(hrEvents.fromDate, last),
            gte(hrEvents.toDate, first),
          ),
        )
        .orderBy(asc(hrEvents.fromDate), asc(hrEvents.id)),
      this.workforce.employees(),
    ]);
    const names = new Map(staff.map((person) => [person.userId, person.fullName]));
    const items: CalendarItem[] = events.map((row) => this.eventItem(row.event, row.type, names));
    for (const person of staff) {
      if (isEmployeeLeft(person)) continue;
      const birthday = person.birthDate ? dayIn(month, person.birthDate) : null;
      if (birthday) {
        items.push({
          date: birthday,
          kind: 'BIRTHDAY',
          title: person.fullName,
          note: null,
          eventId: null,
          toDate: null,
          userId: person.userId,
          photoUrl: person.photoUrl,
          years: null,
          typeId: null,
          typeName: null,
          typeColor: null,
          doneAt: null,
          doneByName: null,
        });
      }
      const anniversary = person.employedOn ? dayIn(month, person.employedOn) : null;
      if (anniversary && person.employedOn) {
        const years = yearsBetween(person.employedOn, anniversary);
        if (years >= 1) {
          items.push({
            date: anniversary,
            kind: 'ANNIVERSARY',
            title: person.fullName,
            note: null,
            eventId: null,
            toDate: null,
            userId: person.userId,
            photoUrl: person.photoUrl,
            years,
            typeId: null,
            typeName: null,
            typeColor: null,
            doneAt: null,
            doneByName: null,
          });
        }
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  private eventItem(
    row: typeof hrEvents.$inferSelect,
    type: typeof hrEventTypes.$inferSelect,
    names: ReadonlyMap<number, string>,
  ): CalendarItem {
    return {
      date: row.fromDate,
      kind: type.kind,
      title: row.title,
      note: row.note,
      eventId: row.id,
      toDate: row.toDate,
      userId: null,
      photoUrl: null,
      years: null,
      typeId: type.id,
      typeName: type.name,
      typeColor: type.color,
      doneAt: row.doneAt?.toISOString() ?? null,
      doneByName: row.doneBy === null ? null : (names.get(row.doneBy) ?? null),
    };
  }

  private async staffNames(): Promise<Map<number, string>> {
    return new Map((await this.workforce.employees()).map((row) => [row.userId, row.fullName]));
  }

  // ── the staff app's first look ─────────────────────────────────────────────

  async feed(ctx: AuthContext) {
    const [messages, polls, mood] = await Promise.all([
      this.myMessages(ctx),
      this.myPolls(ctx),
      this.myMood(ctx),
    ]);
    return {
      unreadNotices: messages.filter((row) => row.kind === 'NOTICE' && !row.read).length,
      unreadNews: messages.filter((row) => row.kind === 'NEWS' && !row.read).length,
      openPolls: polls.filter((row) => row.open && !row.answered).length,
      popups: messages.filter((row) => row.popup && !row.read).slice(0, 5),
      moodToday: mood,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private moment(field: string, value: string | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) throw invalid(field, 'isDate', 'an ISO date and time');
    return at;
  }

  private async activeCount(): Promise<number> {
    return (await this.workforce.employees()).filter((row) => !isEmployeeLeft(row)).length;
  }

  private async photosOf(): Promise<Map<number, string | null>> {
    return new Map((await this.workforce.employees()).map((row) => [row.userId, row.photoUrl]));
  }

  private assertManage(ctx: AuthContext): void {
    if (!ctx.permissions.has(ATTENDANCE_MANAGE)) {
      throw new AppError('FORBIDDEN', `this needs ${ATTENDANCE_MANAGE}`, {
        permission: ATTENDANCE_MANAGE,
      });
    }
  }
}

/** The first day of the next month after a `YYYY-MM-01`. */
function addMonth(first: string): string {
  const year = Number.parseInt(first.slice(0, 4), 10);
  const month = Number.parseInt(first.slice(5, 7), 10);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** This date's day in `YYYY-MM` when its month matches (29 February falls on the 28th otherwise). */
function dayIn(month: string, date: string): string | null {
  if (date.slice(5, 7) !== month.slice(5, 7)) return null;
  const day = date.slice(8);
  const candidate = `${month}-${day}`;
  return isIsoDate(candidate) ? candidate : `${month}-28`;
}
