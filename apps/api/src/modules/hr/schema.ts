import {
  ATTENDANCE_KINDS,
  ATTENDANCE_SOURCES,
  EMPLOYEE_GENDERS,
  EDUCATION_LEVELS,
  EMPLOYMENT_TYPES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  HR_EVENT_KINDS,
  JOB_LEVELS,
  LEFT_REASON_KINDS,
  MARITAL_STATUSES,
  MESSAGE_KINDS,
  POLL_KINDS,
  POLL_QUESTION_KINDS,
  REQUEST_GROUPS,
  REQUEST_STATUSES,
  SCHEDULE_KINDS,
  type ScheduleDay,
} from '@tugeel/shared/hr';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { coordinate, jsonValue } from '../../common/db/types';
import { branches, files, users } from '../identity/schema';

// The tables owned by the hr module (docs/modules/hr.md, ADR-0131): attendance from the staff
// app. Migration 0064_hr_attendance adds by hand the REVOKEs that keep the events from being
// deleted or rewritten: a wrong punch is struck out (its `deleted_*` columns, the one UPDATE the
// app role may make) and a corrected one typed beside it.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * A work site (ADR-0131 #1): a named point with a radius; a punch counts only inside one. Kept
 * by HR; archived, never deleted (events point at it).
 */
export const hrWorkSites = pgTable(
  'hr_work_sites',
  {
    id: id(),
    name: text('name').notNull(),
    lat: coordinate('lat').notNull(),
    lng: coordinate('lng').notNull(),
    radiusM: smallint('radius_m').notNull().default(150),
    branchId: ref('branch_id').references(() => branches.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_work_sites_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check('hr_work_sites_name_present', sql`length(btrim(${t.name})) BETWEEN 1 AND 60`),
    check('hr_work_sites_radius', sql`${t.radiusM} BETWEEN 30 AND 2000`),
    // @tugeel/shared/geo MONGOLIA_BOUNDS, as the customer addresses.
    check(
      'hr_work_sites_in_mongolia',
      sql`${t.lat} BETWEEN 41.5 AND 52.2 AND ${t.lng} BETWEEN 87.7 AND 120`,
    ),
  ],
);

/** The company's one schedule (ADR-0131 #2): the day's start and end, the grace, the workdays. */
export const hrSettings = pgTable(
  'hr_settings',
  {
    id: smallint('id').primaryKey(),
    workStart: text('work_start').notNull().default('09:00'),
    workEnd: text('work_end').notNull().default('18:00'),
    graceMinutes: smallint('grace_minutes').notNull().default(10),
    /** Seven flags, Monday first. */
    workdays: text('workdays').notNull().default('1111110'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('hr_settings_single', sql`${t.id} = 1`),
    check('hr_settings_work_start', sql`${t.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('hr_settings_work_end', sql`${t.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('hr_settings_grace', sql`${t.graceMinutes} BETWEEN 0 AND 120`),
    check('hr_settings_workdays', sql`${t.workdays} ~ '^[01]{7}$'`),
  ],
);

/**
 * One employee's own terms (ADR-0131 #2): a schedule of their own where set, and `tracked` off
 * for staff whose attendance is not counted (the owner). No row = the company schedule, tracked.
 */
export const hrEmployees = pgTable(
  'hr_employees',
  {
    userId: ref('user_id')
      .primaryKey()
      .references(() => users.id),
    tracked: boolean('tracked').notNull().default(true),
    workStart: text('work_start'),
    workEnd: text('work_end'),
    graceMinutes: smallint('grace_minutes'),
    workdays: text('workdays'),
    /** ADR-0144: the card — names, position, division, kind of employment, dates, photo. */
    firstName: text('first_name'),
    lastName: text('last_name'),
    position: text('position'),
    divisionId: ref('division_id').references(() => hrDivisions.id),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES })
      .notNull()
      .default('PERMANENT'),
    gender: text('gender', { enum: EMPLOYEE_GENDERS }),
    employedOn: date('employed_on'),
    /** Left the company: the user is disabled the same day; null while employed. */
    leftOn: date('left_on'),
    leftReason: text('left_reason'),
    photoFileId: ref('photo_file_id').references(() => files.id),
    /** The schedule in force (ADR-0144); null: the company's (or the own hours above). */
    scheduleId: ref('schedule_id').references(() => hrSchedules.id),
    /** ADR-0146: what the dashboard reads; the employee fills it from the staff app, or HR does. */
    birthDate: date('birth_date'),
    education: text('education', { enum: EDUCATION_LEVELS }),
    maritalStatus: text('marital_status', { enum: MARITAL_STATUSES }),
    district: text('district'),
    jobLevel: text('job_level', { enum: JOB_LEVELS }),
    leftReasonKind: text('left_reason_kind', { enum: LEFT_REASON_KINDS }),
    /** Where the record came from, e.g. `timely:4184394`; unique when set. */
    externalRef: text('external_ref'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_employees_external_ref_key')
      .on(t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
    index('hr_employees_division_idx').on(t.divisionId),
    check(
      'hr_employees_employment_type',
      sql`${t.employmentType} IN ('PERMANENT', 'PROBATION', 'CONTRACT', 'PART_TIME', 'INTERN')`,
    ),
    check('hr_employees_gender', sql`${t.gender} IS NULL OR ${t.gender} IN ('MALE', 'FEMALE')`),
    check(
      'hr_employees_names',
      sql`(${t.firstName} IS NULL OR length(btrim(${t.firstName})) BETWEEN 1 AND 60) AND (${t.lastName} IS NULL OR length(btrim(${t.lastName})) BETWEEN 1 AND 60)`,
    ),
    check(
      'hr_employees_position',
      sql`${t.position} IS NULL OR length(btrim(${t.position})) BETWEEN 1 AND 80`,
    ),
    check('hr_employees_left', sql`(${t.leftOn} IS NOT NULL) OR (${t.leftReason} IS NULL)`),
    check(
      'hr_employees_work_start',
      sql`${t.workStart} IS NULL OR ${t.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'hr_employees_work_end',
      sql`${t.workEnd} IS NULL OR ${t.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'hr_employees_grace',
      sql`${t.graceMinutes} IS NULL OR ${t.graceMinutes} BETWEEN 0 AND 120`,
    ),
    check('hr_employees_workdays', sql`${t.workdays} IS NULL OR ${t.workdays} ~ '^[01]{7}$'`),
  ],
);

/** The sites an employee may punch at (ADR-0131 #1); no row = every active site. */
export const hrEmployeeSites = pgTable(
  'hr_employee_sites',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    siteId: ref('site_id')
      .notNull()
      .references(() => hrWorkSites.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.siteId] })],
);

/**
 * A punch (ADR-0131 #3): IN or OUT at a server instant, on the Ulaanbaatar date it fell on, with
 * the phone's fix and the site it was inside (APP), or typed by HR with a note (OFFICE). Never
 * updated or deleted; struck out with `deleted_*` and a reason.
 */
export const hrAttendanceEvents = pgTable(
  'hr_attendance_events',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ATTENDANCE_KINDS }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    businessDate: date('business_date').notNull(),
    source: text('source', { enum: ATTENDANCE_SOURCES }).notNull(),
    siteId: ref('site_id').references(() => hrWorkSites.id),
    lat: coordinate('lat'),
    lng: coordinate('lng'),
    accuracyM: integer('accuracy_m'),
    distanceM: integer('distance_m'),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: userRef('deleted_by'),
    deleteReason: text('delete_reason'),
  },
  (t) => [
    index('hr_attendance_events_user_date_idx').on(t.userId, t.businessDate, t.at),
    index('hr_attendance_events_date_idx').on(t.businessDate, t.at),
    check('hr_attendance_events_kind', sql`${t.kind} IN ('IN', 'OUT')`),
    check('hr_attendance_events_source', sql`${t.source} IN ('APP', 'OFFICE', 'REQUEST')`),
    check('hr_attendance_events_gps_pair', sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    check(
      'hr_attendance_events_app_fix',
      sql`${t.source} <> 'APP' OR (${t.lat} IS NOT NULL AND ${t.siteId} IS NOT NULL AND ${t.distanceM} IS NOT NULL)`,
    ),
    check(
      'hr_attendance_events_note',
      sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 200`,
    ),
    check(
      'hr_attendance_events_deleted',
      sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL) AND (${t.deletedAt} IS NULL) = (${t.deleteReason} IS NULL)`,
    ),
  ],
);

/** A division («Алба хэлтэс», ADR-0144): a flat list of the company's teams; archived, never deleted. */
export const hrDivisions = pgTable(
  'hr_divisions',
  {
    id: id(),
    name: text('name').notNull(),
    sort: smallint('sort').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_divisions_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check('hr_divisions_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 60`),
  ],
);

/**
 * A schedule (ADR-0144): FIXED hours per weekday («Тогтмол») or FLEXIBLE hours per weekday
 * («Уян хатан»); `days` holds the checked `ScheduleDay`s. An employee follows one at a time.
 */
export const hrSchedules = pgTable(
  'hr_schedules',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: SCHEDULE_KINDS }).notNull(),
    color: text('color').notNull().default('#f59e0b'),
    days: jsonValue('days').$type<ScheduleDay[]>().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    updatedBy: userRef('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_schedules_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check('hr_schedules_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 60`),
    check('hr_schedules_kind', sql`${t.kind} IN ('FIXED', 'FLEXIBLE')`),
    check('hr_schedules_color', sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/** A kind of time request (ADR-0144): named by HR, of one of the groups that decide its effect. */
export const hrRequestTypes = pgTable(
  'hr_request_types',
  {
    id: id(),
    name: text('name').notNull(),
    group: text('group', { enum: REQUEST_GROUPS }).notNull(),
    color: text('color').notNull(),
    /** Whole days (from–to) rather than hours on one day. */
    wholeDays: boolean('whole_days').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sort: smallint('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_request_types_name_key').on(sql`lower(${t.name})`),
    check('hr_request_types_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 60`),
    check(
      'hr_request_types_group',
      sql`${t.group} IN ('NOT_WORKED', 'WORKED', 'OVERTIME', 'OVERTIME_LEAVE', 'PUNCH_CHOSEN', 'PUNCH_SENT', 'OTHER')`,
    ),
    check('hr_request_types_color', sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/**
 * A time request (ADR-0144, «Цагийн хүсэлт»): sent by the employee from the staff app (or typed
 * by HR), PENDING until HR approves or rejects it; the employee may cancel a pending one. Whole
 * days run `from_date`–`to_date`; hours run `starts_at`–`ends_at` on `from_date`; a punch
 * request names `punch_kind` at `starts_at` and, approved, writes the punch (`event_id`).
 * Never deleted.
 */
export const hrRequests = pgTable(
  'hr_requests',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    typeId: ref('type_id')
      .notNull()
      .references(() => hrRequestTypes.id),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    punchKind: text('punch_kind', { enum: ATTENDANCE_KINDS }),
    lat: coordinate('lat'),
    lng: coordinate('lng'),
    accuracyM: integer('accuracy_m'),
    note: text('note'),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('PENDING'),
    decidedBy: userRef('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    eventId: ref('event_id').references(() => hrAttendanceEvents.id),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('hr_requests_user_idx').on(t.userId, t.fromDate),
    index('hr_requests_status_idx').on(t.status, t.createdAt),
    index('hr_requests_dates_idx').on(t.fromDate, t.toDate),
    check('hr_requests_dates', sql`${t.toDate} >= ${t.fromDate}`),
    check(
      'hr_requests_hours',
      sql`(${t.startsAt} IS NULL AND ${t.endsAt} IS NULL) OR (${t.startsAt} IS NOT NULL AND (${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}))`,
    ),
    check(
      'hr_requests_status',
      sql`${t.status} IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`,
    ),
    check('hr_requests_punch_kind', sql`${t.punchKind} IS NULL OR ${t.punchKind} IN ('IN', 'OUT')`),
    check('hr_requests_gps_pair', sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    check('hr_requests_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`),
    check('hr_requests_decided', sql`(${t.decidedAt} IS NULL) = (${t.decidedBy} IS NULL)`),
  ],
);

// ── The staff's own side (ADR-0146, migration 0070_hr_engagement) ───────────

/** An employee's child, for «Ажилтны хүүхдүүдийн мэдээлэл»; the set is replaced on each save. */
export const hrEmployeeChildren = pgTable(
  'hr_employee_children',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name'),
    gender: text('gender', { enum: EMPLOYEE_GENDERS }),
    birthDate: date('birth_date').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('hr_employee_children_user_idx').on(t.userId)],
);

/**
 * A notice or a piece of news for the staff (ADR-0146 #2): published at `publish_at` to everybody,
 * or to the people in `hr_message_recipients`; withdrawn, never deleted.
 */
export const hrMessages = pgTable(
  'hr_messages',
  {
    id: id(),
    kind: text('kind', { enum: MESSAGE_KINDS }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category'),
    imageFileId: ref('image_file_id').references(() => files.id),
    popup: boolean('popup').notNull().default(false),
    publishAt: timestamp('publish_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_messages_publish_idx').on(t.kind, t.publishAt),
    check('hr_messages_kind', sql`${t.kind} IN ('NOTICE', 'NEWS')`),
  ],
);

export const hrMessageRecipients = pgTable(
  'hr_message_recipients',
  {
    messageId: ref('message_id')
      .notNull()
      .references(() => hrMessages.id),
    userId: userRef('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('hr_message_recipients_user_idx').on(t.userId),
  ],
);

export const hrMessageReads = pgTable(
  'hr_message_reads',
  {
    messageId: ref('message_id')
      .notNull()
      .references(() => hrMessages.id),
    userId: userRef('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/** A vote or a survey (ADR-0146 #3), open from `starts_at` until `ends_at` or closed by HR. */
export const hrPolls = pgTable(
  'hr_polls',
  {
    id: id(),
    kind: text('kind', { enum: POLL_KINDS }).notNull(),
    title: text('title').notNull(),
    note: text('note'),
    imageFileId: ref('image_file_id').references(() => files.id),
    showResults: boolean('show_results').notNull().default(false),
    allowChange: boolean('allow_change').notNull().default(false),
    anonymous: boolean('anonymous').notNull().default(false),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_polls_starts_idx').on(t.startsAt),
    check('hr_polls_kind', sql`${t.kind} IN ('VOTE', 'SURVEY')`),
    check('hr_polls_dates', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
  ],
);

export const hrPollRecipients = pgTable(
  'hr_poll_recipients',
  {
    pollId: ref('poll_id')
      .notNull()
      .references(() => hrPolls.id),
    userId: userRef('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pollId, t.userId] }),
    index('hr_poll_recipients_user_idx').on(t.userId),
  ],
);

export const hrPollQuestions = pgTable(
  'hr_poll_questions',
  {
    id: id(),
    pollId: ref('poll_id')
      .notNull()
      .references(() => hrPolls.id),
    sort: smallint('sort').notNull().default(0),
    text: text('text').notNull(),
    kind: text('kind', { enum: POLL_QUESTION_KINDS }).notNull(),
    required: boolean('required').notNull().default(true),
  },
  (t) => [
    index('hr_poll_questions_poll_idx').on(t.pollId, t.sort),
    check('hr_poll_questions_kind', sql`${t.kind} IN ('SINGLE', 'MULTI', 'TEXT', 'SCALE')`),
  ],
);

export const hrPollOptions = pgTable(
  'hr_poll_options',
  {
    id: id(),
    questionId: ref('question_id')
      .notNull()
      .references(() => hrPollQuestions.id),
    sort: smallint('sort').notNull().default(0),
    text: text('text').notNull(),
  },
  (t) => [index('hr_poll_options_question_idx').on(t.questionId, t.sort)],
);

/** One row per chosen option, written text or scale value; replaced when the poll allows it. */
export const hrPollAnswers = pgTable(
  'hr_poll_answers',
  {
    id: id(),
    pollId: ref('poll_id')
      .notNull()
      .references(() => hrPolls.id),
    questionId: ref('question_id')
      .notNull()
      .references(() => hrPollQuestions.id),
    userId: userRef('user_id').notNull(),
    optionId: ref('option_id').references(() => hrPollOptions.id),
    text: text('text'),
    value: smallint('value'),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_poll_answers_poll_idx').on(t.pollId, t.userId),
    index('hr_poll_answers_question_idx').on(t.questionId),
    check('hr_poll_answers_value', sql`${t.value} IS NULL OR ${t.value} BETWEEN 1 AND 5`),
  ],
);

/** «Сэтгэл ханамж»: one face per person per business day; HR reads only the counts. */
export const hrMoods = pgTable(
  'hr_moods',
  {
    userId: userRef('user_id').notNull(),
    day: date('day').notNull(),
    score: smallint('score').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    index('hr_moods_day_idx').on(t.day),
    check('hr_moods_score', sql`${t.score} BETWEEN 1 AND 5`),
  ],
);

/** «Санал хүсэлт»: `user_id` is empty when sent without a name; HR marks it and may answer. */
export const hrFeedback = pgTable(
  'hr_feedback',
  {
    id: id(),
    userId: userRef('user_id'),
    category: text('category', { enum: FEEDBACK_CATEGORIES }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: FEEDBACK_STATUSES }).notNull().default('NEW'),
    reply: text('reply'),
    repliedBy: userRef('replied_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('hr_feedback_created_idx').on(t.createdAt),
    index('hr_feedback_user_idx').on(t.userId),
    check(
      'hr_feedback_category',
      sql`${t.category} IN ('SUGGESTION', 'COMPLAINT', 'QUESTION', 'OTHER')`,
    ),
    check('hr_feedback_status', sql`${t.status} IN ('NEW', 'SEEN', 'DONE')`),
  ],
);

/** «Талархал»: thanks from one employee to another, read by everybody. */
export const hrThanks = pgTable(
  'hr_thanks',
  {
    id: id(),
    fromUserId: userRef('from_user_id').notNull(),
    toUserId: userRef('to_user_id').notNull(),
    note: text('note').notNull(),
    day: date('day').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_thanks_day_idx').on(t.day),
    index('hr_thanks_to_idx').on(t.toUserId, t.day),
    check('hr_thanks_not_self', sql`${t.fromUserId} <> ${t.toUserId}`),
  ],
);

/** «Илгээсэн байршил»: where an employee said they are, with a note. */
export const hrLocationShares = pgTable(
  'hr_location_shares',
  {
    id: id(),
    userId: userRef('user_id').notNull(),
    lat: coordinate('lat').notNull(),
    lng: coordinate('lng').notNull(),
    accuracyM: integer('accuracy_m'),
    note: text('note'),
    day: date('day').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_location_shares_day_idx').on(t.day),
    index('hr_location_shares_user_idx').on(t.userId, t.day),
  ],
);

/** HR's own entry on the calendar (ADR-0146 #6). */
/** The calendar's types, HR's own list (ADR-0171). Archived, never deleted: old events keep theirs. */
export const hrEventTypes = pgTable(
  'hr_event_types',
  {
    id: id(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    /** What an installed staff app draws for this type; a type HR adds is an `EVENT`. */
    kind: text('kind', { enum: HR_EVENT_KINDS }).notNull().default('EVENT'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_event_types_name_key').on(sql`lower(${t.name})`),
    check('hr_event_types_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 40`),
    check('hr_event_types_color', sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check('hr_event_types_kind', sql`${t.kind} IN ('EVENT', 'MEETING', 'HOLIDAY')`),
  ],
);

export const hrEvents = pgTable(
  'hr_events',
  {
    id: id(),
    typeId: bigint('type_id', { mode: 'number' })
      .notNull()
      .references(() => hrEventTypes.id),
    title: text('title').notNull(),
    note: text('note'),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    /** Who marked the work done, and when (ADR-0171 #8). */
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: userRef('done_by'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('hr_events_dates_idx').on(t.fromDate, t.toDate),
    check('hr_events_done', sql`(${t.doneAt} IS NULL) = (${t.doneBy} IS NULL)`),
    index('hr_events_type_idx').on(t.typeId),
    check('hr_events_dates', sql`${t.toDate} >= ${t.fromDate}`),
  ],
);
