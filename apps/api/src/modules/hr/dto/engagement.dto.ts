import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  CALENDAR_ITEM_KINDS,
  type CalendarItemKind,
  EDUCATION_LEVELS,
  type EducationLevel,
  EMPLOYEE_GENDERS,
  type EmployeeGender,
  ENGAGEMENT_LIMITS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackStatus,
  HR_EVENT_KINDS,
  type HrEventKind,
  JOB_LEVELS,
  type JobLevel,
  MARITAL_STATUSES,
  type MaritalStatus,
  MESSAGE_KINDS,
  type MessageKind,
  POLL_KINDS,
  POLL_QUESTION_KINDS,
  type PollKind,
  type PollQuestionKind,
} from '@tugeel/shared/hr';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toInt = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number.parseInt(value, 10) : value;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const COORDINATE = /^-?\d{1,3}(\.\d{1,7})?$/;

// ── notices and news ─────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrMessage' })
export class HrMessageDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: MESSAGE_KINDS, enumName: 'HrMessageKind' }) kind: MessageKind;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: String, nullable: true }) category: string | null;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty() popup: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) publishAt: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) withdrawnAt: Date | null;
  @ApiProperty() createdByName: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: [Number], description: 'Everybody when empty' }) userIds: number[];
  @ApiProperty() recipients: number;
  @ApiProperty() reads: number;
}

@ApiSchema({ name: 'HrMyMessage' })
export class HrMyMessageDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: MESSAGE_KINDS, enumName: 'HrMessageKind' }) kind: MessageKind;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: String, nullable: true }) category: string | null;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty() popup: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) publishAt: Date;
  @ApiProperty() read: boolean;
}

@ApiSchema({ name: 'HrMessageRequest' })
export class HrMessageRequestDto {
  @ApiProperty({ enum: MESSAGE_KINDS, enumName: 'HrMessageKind' })
  @IsIn(MESSAGE_KINDS)
  kind: MessageKind;
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxTitle)
  title: string;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(ENGAGEMENT_LIMITS.maxBody) body: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxCategory)
  category?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  imageFileId?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() popup?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  publishAt?: string | null;
  @ApiPropertyOptional({ type: [Number], description: 'Everybody when left out or empty' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxRecipients)
  @IsInt({ each: true })
  userIds?: number[];
}

@ApiSchema({ name: 'HrMessagesQuery' })
export class HrMessagesQueryDto {
  @ApiPropertyOptional({ enum: MESSAGE_KINDS, enumName: 'HrMessageKind' })
  @IsOptional()
  @IsIn(MESSAGE_KINDS)
  kind?: MessageKind;
}

@ApiSchema({ name: 'HrReadMessagesRequest' })
export class HrReadMessagesRequestDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  ids: number[];
}

// ── votes and surveys ────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrPollOption' })
export class HrPollOptionDto {
  @ApiProperty() id: number;
  @ApiProperty() text: string;
  @ApiProperty() count: number;
  @ApiProperty({ type: [String] }) voters: string[];
}

@ApiSchema({ name: 'HrPollMine' })
export class HrPollMineDto {
  @ApiProperty({ type: [Number] }) optionIds: number[];
  @ApiProperty({ type: String, nullable: true }) text: string | null;
  @ApiProperty({ type: Number, nullable: true }) value: number | null;
}

@ApiSchema({ name: 'HrPollQuestion' })
export class HrPollQuestionDto {
  @ApiProperty() id: number;
  @ApiProperty() text: string;
  @ApiProperty({ enum: POLL_QUESTION_KINDS, enumName: 'HrPollQuestionKind' })
  kind: PollQuestionKind;
  @ApiProperty() required: boolean;
  @ApiProperty({ type: [HrPollOptionDto] }) options: HrPollOptionDto[];
  @ApiProperty({ type: [String] }) texts: string[];
  @ApiProperty({ type: String, nullable: true }) average: string | null;
  @ApiProperty() answered: number;
  @ApiProperty({ type: HrPollMineDto }) mine: HrPollMineDto;
}

@ApiSchema({ name: 'HrPoll' })
export class HrPollDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: POLL_KINDS, enumName: 'HrPollKind' }) kind: PollKind;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty() showResults: boolean;
  @ApiProperty() allowChange: boolean;
  @ApiProperty() anonymous: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt: Date | null;
  @ApiProperty() open: boolean;
  @ApiProperty() createdByName: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: [Number] }) userIds: number[];
  @ApiProperty() recipients: number;
  @ApiProperty() respondents: number;
  @ApiProperty() answered: boolean;
  @ApiProperty() resultsShown: boolean;
  @ApiProperty({ type: [HrPollQuestionDto] }) questions: HrPollQuestionDto[];
}

@ApiSchema({ name: 'HrPollQuestionRequest' })
export class HrPollQuestionRequestDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxTitle * 2)
  text: string;
  @ApiProperty({ enum: POLL_QUESTION_KINDS, enumName: 'HrPollQuestionKind' })
  @IsIn(POLL_QUESTION_KINDS)
  kind: PollQuestionKind;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxOptions)
  @IsString({ each: true })
  options?: string[];
}

@ApiSchema({ name: 'HrPollRequest' })
export class HrPollRequestDto {
  @ApiProperty({ enum: POLL_KINDS, enumName: 'HrPollKind' }) @IsIn(POLL_KINDS) kind: PollKind;
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxTitle)
  title: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxNote)
  note?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  imageFileId?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showResults?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowChange?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anonymous?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxRecipients)
  @IsInt({ each: true })
  userIds?: number[];
  @ApiProperty({ type: [HrPollQuestionRequestDto] })
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxQuestions)
  @ValidateNested({ each: true })
  @Type(() => HrPollQuestionRequestDto)
  questions: HrPollQuestionRequestDto[];
}

@ApiSchema({ name: 'HrPollsQuery' })
export class HrPollsQueryDto {
  @ApiPropertyOptional({ enum: POLL_KINDS, enumName: 'HrPollKind' })
  @IsOptional()
  @IsIn(POLL_KINDS)
  kind?: PollKind;
}

@ApiSchema({ name: 'HrPollAnswerRequest' })
export class HrPollAnswerRequestDto {
  @ApiProperty() @IsInt() @Min(1) questionId: number;
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxOptions)
  @IsInt({ each: true })
  optionIds?: number[];
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxAnswerText)
  text?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ENGAGEMENT_LIMITS.scaleMax)
  value?: number | null;
}

@ApiSchema({ name: 'HrPollAnswersRequest' })
export class HrPollAnswersRequestDto {
  @ApiProperty({ type: [HrPollAnswerRequestDto] })
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxQuestions)
  @ValidateNested({ each: true })
  @Type(() => HrPollAnswerRequestDto)
  answers: HrPollAnswerRequestDto[];
}

// ── mood, feedback, thanks, location ─────────────────────────────────────────

@ApiSchema({ name: 'HrRangeQuery' })
export class HrRangeQueryDto {
  @ApiProperty() @Matches(DATE) from: string;
  @ApiProperty() @Matches(DATE) to: string;
}

@ApiSchema({ name: 'HrMoodRequest' })
export class HrMoodRequestDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) score: number;
}

@ApiSchema({ name: 'HrMyMood' })
export class HrMyMoodDto {
  @ApiProperty() day: string;
  @ApiProperty() score: number;
}

@ApiSchema({ name: 'HrMoodCount' })
export class HrMoodCountDto {
  @ApiProperty() score: number;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'HrMoods' })
export class HrMoodsDto {
  @ApiProperty({ type: [HrMoodCountDto] }) scores: HrMoodCountDto[];
  @ApiProperty() total: number;
}

@ApiSchema({ name: 'HrFeedback' })
export class HrFeedbackDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: Number, nullable: true }) userId: number | null;
  @ApiProperty({ type: String, nullable: true }) fullName: string | null;
  @ApiProperty({ enum: FEEDBACK_CATEGORIES, enumName: 'HrFeedbackCategory' })
  category: FeedbackCategory;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ enum: FEEDBACK_STATUSES, enumName: 'HrFeedbackStatus' }) status: FeedbackStatus;
  @ApiProperty({ type: String, nullable: true }) reply: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

@ApiSchema({ name: 'HrFeedbackRequest' })
export class HrFeedbackRequestDto {
  @ApiProperty({ enum: FEEDBACK_CATEGORIES, enumName: 'HrFeedbackCategory' })
  @IsIn(FEEDBACK_CATEGORIES)
  category: FeedbackCategory;
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxTitle)
  title: string;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(ENGAGEMENT_LIMITS.maxBody) body: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anonymous?: boolean;
}

@ApiSchema({ name: 'HrFeedbackQuery' })
export class HrFeedbackQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string;
  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES, enumName: 'HrFeedbackStatus' })
  @IsOptional()
  @IsIn(FEEDBACK_STATUSES)
  status?: FeedbackStatus;
  @ApiPropertyOptional({ enum: FEEDBACK_CATEGORIES, enumName: 'HrFeedbackCategory' })
  @IsOptional()
  @IsIn(FEEDBACK_CATEGORIES)
  category?: FeedbackCategory;
}

@ApiSchema({ name: 'HrFeedbackDecision' })
export class HrFeedbackDecisionDto {
  @ApiProperty({ enum: FEEDBACK_STATUSES, enumName: 'HrFeedbackStatus' })
  @IsIn(FEEDBACK_STATUSES)
  status: FeedbackStatus;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxBody)
  reply?: string | null;
}

@ApiSchema({ name: 'HrThanksEntry' })
export class HrThanksEntryDto {
  @ApiProperty() id: number;
  @ApiProperty() fromUserId: number;
  @ApiProperty() fromName: string;
  @ApiProperty() toUserId: number;
  @ApiProperty() toName: string;
  @ApiProperty({ type: String, nullable: true }) toPhotoUrl: string | null;
  @ApiProperty() note: string;
  @ApiProperty() day: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

@ApiSchema({ name: 'HrThanksRank' })
export class HrThanksRankDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'HrThanks' })
export class HrThanksDto {
  @ApiProperty({ type: [HrThanksEntryDto] }) items: HrThanksEntryDto[];
  @ApiProperty({ type: [HrThanksRankDto] }) ranking: HrThanksRankDto[];
}

@ApiSchema({ name: 'HrThanksRequest' })
export class HrThanksRequestDto {
  @ApiProperty() @IsInt() @Min(1) toUserId: number;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(ENGAGEMENT_LIMITS.maxNote) note: string;
}

@ApiSchema({ name: 'HrLocationShare' })
export class HrLocationShareDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty() lat: string;
  @ApiProperty() lng: string;
  @ApiProperty({ type: Number, nullable: true }) accuracyM: number | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty() day: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

@ApiSchema({ name: 'HrLocationShareRequest' })
export class HrLocationShareRequestDto {
  @ApiProperty() @IsString() @Matches(COORDINATE) lat: string;
  @ApiProperty() @IsString() @Matches(COORDINATE) lng: string;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  accuracyM?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'HrLocationSharesQuery' })
export class HrLocationSharesQueryDto extends HrRangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(toInt) @IsInt() @Min(1) userId?: number;
}

// ── the calendar ─────────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrCalendarItem' })
export class HrCalendarItemDto {
  @ApiProperty() date: string;
  @ApiProperty({ enum: CALENDAR_ITEM_KINDS, enumName: 'HrCalendarItemKind' })
  kind: CalendarItemKind;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: Number, nullable: true }) eventId: number | null;
  @ApiProperty({ type: String, nullable: true }) toDate: string | null;
  @ApiProperty({ type: Number, nullable: true }) userId: number | null;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty({ type: Number, nullable: true }) years: number | null;
}

@ApiSchema({ name: 'HrCalendarQuery' })
export class HrCalendarQueryDto {
  @ApiProperty({ description: 'YYYY-MM' }) @Matches(MONTH) month: string;
}

@ApiSchema({ name: 'HrEventRequest' })
export class HrEventRequestDto {
  @ApiProperty({ enum: HR_EVENT_KINDS, enumName: 'HrEventKind' })
  @IsIn(HR_EVENT_KINDS)
  kind: HrEventKind;
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxTitle)
  title: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxNote)
  note?: string | null;
  @ApiProperty() @Matches(DATE) fromDate: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Matches(DATE)
  toDate?: string | null;
}

// ── the staff app's first look ───────────────────────────────────────────────

@ApiSchema({ name: 'HrFeed' })
export class HrFeedDto {
  @ApiProperty() unreadNotices: number;
  @ApiProperty() unreadNews: number;
  @ApiProperty() openPolls: number;
  @ApiProperty({ type: [HrMyMessageDto] }) popups: HrMyMessageDto[];
  @ApiProperty({ type: Number, nullable: true }) moodToday: number | null;
}

// ── an employee's details ────────────────────────────────────────────────────

@ApiSchema({ name: 'HrChild' })
export class HrChildDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxCategory)
  name?: string | null;
  @ApiPropertyOptional({ enum: EMPLOYEE_GENDERS, enumName: 'EmployeeGender', nullable: true })
  @IsOptional()
  @IsIn(EMPLOYEE_GENDERS)
  gender?: EmployeeGender | null;
  @ApiProperty() @Matches(DATE) birthDate: string;
}

@ApiSchema({ name: 'HrProfile' })
export class HrProfileDto {
  @ApiProperty({ type: String, nullable: true }) birthDate: string | null;
  @ApiProperty({ enum: EMPLOYEE_GENDERS, enumName: 'EmployeeGender', nullable: true })
  gender: EmployeeGender | null;
  @ApiProperty({ enum: EDUCATION_LEVELS, enumName: 'HrEducationLevel', nullable: true })
  education: EducationLevel | null;
  @ApiProperty({ enum: MARITAL_STATUSES, enumName: 'HrMaritalStatus', nullable: true })
  maritalStatus: MaritalStatus | null;
  @ApiProperty({ type: String, nullable: true }) district: string | null;
  @ApiProperty({ type: [HrChildDto] }) children: HrChildDto[];
}

@ApiSchema({ name: 'HrProfileRequest' })
export class HrProfileRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Matches(DATE)
  birthDate?: string | null;
  @ApiPropertyOptional({ enum: EMPLOYEE_GENDERS, enumName: 'EmployeeGender', nullable: true })
  @IsOptional()
  @IsIn(EMPLOYEE_GENDERS)
  gender?: EmployeeGender | null;
  @ApiPropertyOptional({ enum: EDUCATION_LEVELS, enumName: 'HrEducationLevel', nullable: true })
  @IsOptional()
  @IsIn(EDUCATION_LEVELS)
  education?: EducationLevel | null;
  @ApiPropertyOptional({ enum: MARITAL_STATUSES, enumName: 'HrMaritalStatus', nullable: true })
  @IsOptional()
  @IsIn(MARITAL_STATUSES)
  maritalStatus?: MaritalStatus | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ENGAGEMENT_LIMITS.maxDistrict)
  district?: string | null;
  @ApiProperty({ type: [HrChildDto] })
  @IsArray()
  @ArrayMaxSize(ENGAGEMENT_LIMITS.maxChildren)
  @ValidateNested({ each: true })
  @Type(() => HrChildDto)
  children: HrChildDto[];
}

@ApiSchema({ name: 'HrStaffDetailsRequest' })
export class HrStaffDetailsRequestDto extends HrProfileRequestDto {
  @ApiPropertyOptional({ enum: JOB_LEVELS, enumName: 'HrJobLevel', nullable: true })
  @IsOptional()
  @IsIn(JOB_LEVELS)
  jobLevel?: JobLevel | null;
}

// ── the dashboard ────────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrCount' })
export class HrCountDto {
  @ApiProperty() key: string;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'HrGenderCount' })
export class HrGenderCountDto {
  @ApiProperty() key: string;
  @ApiProperty() male: number;
  @ApiProperty() female: number;
  @ApiProperty() unknown: number;
}

@ApiSchema({ name: 'HrMatrixRow' })
export class HrMatrixRowDto {
  @ApiProperty() division: string;
  @ApiProperty({ type: [HrCountDto] }) levels: HrCountDto[];
  @ApiProperty() total: number;
}

@ApiSchema({ name: 'HrMovementMonth' })
export class HrMovementMonthDto {
  @ApiProperty() month: string;
  @ApiProperty() joined: number;
  @ApiProperty() left: number;
}

@ApiSchema({ name: 'HrMissingDetails' })
export class HrMissingDetailsDto {
  @ApiProperty() birthDate: number;
  @ApiProperty() gender: number;
  @ApiProperty() education: number;
  @ApiProperty() district: number;
  @ApiProperty() level: number;
}

@ApiSchema({ name: 'HrWorkforceInsights' })
export class HrWorkforceInsightsDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() total: number;
  @ApiProperty() totalBefore: number;
  @ApiProperty() joined: number;
  @ApiProperty() left: number;
  @ApiProperty() joinedBefore: number;
  @ApiProperty() leftBefore: number;
  @ApiProperty({ type: String, nullable: true }) averageAge: string | null;
  @ApiProperty({ type: String, nullable: true }) averageAgeBefore: string | null;
  @ApiProperty({ type: String, nullable: true }) averageTenure: string | null;
  @ApiProperty({ type: String, nullable: true }) averageTenureBefore: string | null;
  @ApiProperty({ type: [HrMatrixRowDto] }) matrix: HrMatrixRowDto[];
  @ApiProperty({ type: [HrCountDto] }) tenure: HrCountDto[];
  @ApiProperty({ type: [HrCountDto] }) education: HrCountDto[];
  @ApiProperty({ type: [HrGenderCountDto] }) ageGender: HrGenderCountDto[];
  @ApiProperty({ type: [HrCountDto] }) genders: HrCountDto[];
  @ApiProperty({ type: [HrCountDto] }) districts: HrCountDto[];
  @ApiProperty({ type: [HrCountDto] }) marital: HrCountDto[];
  @ApiProperty({ type: [HrGenderCountDto] }) children: HrGenderCountDto[];
  @ApiProperty() childrenTotal: number;
  @ApiProperty({ type: [HrCountDto] }) employmentTypes: HrCountDto[];
  @ApiProperty({ type: [HrMovementMonthDto] }) movement: HrMovementMonthDto[];
  @ApiProperty({ type: [HrCountDto] }) leftReasons: HrCountDto[];
  @ApiProperty({ type: HrMissingDetailsDto }) missing: HrMissingDetailsDto;
}

@ApiSchema({ name: 'HrAttendanceDivision' })
export class HrAttendanceDivisionDto {
  @ApiProperty() division: string;
  @ApiProperty() plannedMinutes: number;
  @ApiProperty() workedMinutes: number;
  @ApiProperty({ type: String, nullable: true }) performance: string | null;
}

@ApiSchema({ name: 'HrAttendanceEmployee' })
export class HrAttendanceEmployeeDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty({ type: String, nullable: true }) division: string | null;
  @ApiProperty() plannedMinutes: number;
  @ApiProperty() workedMinutes: number;
  @ApiProperty() lateMinutes: number;
  @ApiProperty() absentDays: number;
  @ApiProperty({ type: String, nullable: true }) performance: string | null;
}

@ApiSchema({ name: 'HrAttendanceTrend' })
export class HrAttendanceTrendDto {
  @ApiProperty() month: string;
  @ApiProperty() plannedMinutes: number;
  @ApiProperty() workedMinutes: number;
  @ApiProperty({ type: String, nullable: true }) performance: string | null;
}

@ApiSchema({ name: 'HrAttendanceInsights' })
export class HrAttendanceInsightsDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() plannedMinutes: number;
  @ApiProperty() workedMinutes: number;
  @ApiProperty({ type: String, nullable: true }) performance: string | null;
  @ApiProperty({ type: String, nullable: true }) performanceBefore: string | null;
  @ApiProperty({ type: String, nullable: true }) averageArrival: string | null;
  @ApiProperty({ type: String, nullable: true }) averageDeparture: string | null;
  @ApiProperty() averageLateMinutes: number;
  @ApiProperty() averageEarlyMinutes: number;
  @ApiProperty() absentDays: number;
  @ApiProperty() lateDays: number;
  @ApiProperty({ type: [HrAttendanceDivisionDto] }) divisions: HrAttendanceDivisionDto[];
  @ApiProperty({ type: [HrAttendanceEmployeeDto] }) employees: HrAttendanceEmployeeDto[];
  @ApiProperty({ type: [HrAttendanceTrendDto] }) trend: HrAttendanceTrendDto[];
}

@ApiSchema({ name: 'HrRequestTypeCount' })
export class HrRequestTypeCountDto {
  @ApiProperty() typeId: number;
  @ApiProperty() name: string;
  @ApiProperty() color: string;
  @ApiProperty() count: number;
  @ApiProperty() days: number;
}

@ApiSchema({ name: 'HrRequestEmployeeCount' })
export class HrRequestEmployeeCountDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'HrRequestMonth' })
export class HrRequestMonthDto {
  @ApiProperty() month: string;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'HrRequestInsights' })
export class HrRequestInsightsDto {
  @ApiProperty() year: number;
  @ApiProperty() total: number;
  @ApiProperty() minutes: number;
  @ApiProperty({ type: [HrRequestTypeCountDto] }) types: HrRequestTypeCountDto[];
  @ApiProperty({ type: [HrRequestEmployeeCountDto] }) employees: HrRequestEmployeeCountDto[];
  @ApiProperty({ type: [HrRequestMonthDto] }) months: HrRequestMonthDto[];
  @ApiProperty({ type: [HrCountDto] }) statuses: HrCountDto[];
}

@ApiSchema({ name: 'HrInsightYearQuery' })
export class HrInsightYearQueryDto {
  @ApiProperty() @Transform(toInt) @IsInt() @Min(2000) @Max(2100) year: number;
}
