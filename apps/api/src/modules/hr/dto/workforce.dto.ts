import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ATTENDANCE_KINDS,
  type AttendanceKind,
  EMPLOYEE_GENDERS,
  type EmployeeGender,
  EMPLOYMENT_TYPES,
  type EducationLevel,
  type EmploymentType,
  EDUCATION_LEVELS,
  JOB_LEVELS,
  type JobLevel,
  LEFT_REASON_KINDS,
  type LeftReasonKind,
  MARITAL_STATUSES,
  type MaritalStatus,
  REPORT_STATUSES,
  REQUEST_GROUPS,
  REQUEST_STATUSES,
  type ReportStatus,
  type RequestGroup,
  type RequestStatus,
  SCHEDULE_KINDS,
  type ScheduleKind,
  WORKFORCE_LIMITS,
} from '@tugeel/shared/hr';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
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
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value !== ''
    ? Number.parseInt(value, 10)
    : typeof value === 'number'
      ? value
      : undefined;
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── divisions ──────────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrDivision' })
export class HrDivisionDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() sort: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty() employeeCount: number;
}

@ApiSchema({ name: 'HrDivisionRequest' })
export class HrDivisionRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(WORKFORCE_LIMITS.maxName) name: string;
  @ApiProperty() @IsInt() @Min(0) @Max(999) sort: number;
}

@ApiSchema({ name: 'HrArchiveRequest' })
export class HrArchiveRequestDto {
  @ApiProperty() @IsBoolean() archived: boolean;
}

export class IncludeArchivedQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() includeArchived?: boolean;
}

// ── employees ──────────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrStaffChild' })
export class HrStaffChildDto {
  @ApiPropertyOptional({ type: String, nullable: true }) name?: string | null;
  @ApiPropertyOptional({ enum: EMPLOYEE_GENDERS, enumName: 'EmployeeGender', nullable: true })
  gender?: EmployeeGender | null;
  @ApiProperty() birthDate: string;
}

@ApiSchema({ name: 'HrStaff' })
export class HrStaffDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) firstName: string | null;
  @ApiProperty({ type: String, nullable: true }) lastName: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ type: [String] }) roles: string[];
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ type: Number, nullable: true }) divisionId: number | null;
  @ApiProperty({ type: String, nullable: true }) divisionName: string | null;
  @ApiProperty({ enum: EMPLOYMENT_TYPES, enumName: 'EmploymentType' })
  employmentType: EmploymentType;
  @ApiProperty({ enum: EMPLOYEE_GENDERS, enumName: 'EmployeeGender', nullable: true })
  gender: EmployeeGender | null;
  @ApiProperty({ type: String, nullable: true }) employedOn: string | null;
  @ApiProperty({ type: String, nullable: true }) leftOn: string | null;
  @ApiProperty({ type: String, nullable: true }) leftReason: string | null;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty({ type: Number, nullable: true }) scheduleId: number | null;
  @ApiProperty({ type: String, nullable: true }) scheduleName: string | null;
  @ApiProperty() tracked: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lockedUntil: Date | null;
  @ApiProperty() passwordSet: boolean;
  @ApiProperty({ type: String, nullable: true }) birthDate: string | null;
  @ApiProperty({ enum: EDUCATION_LEVELS, enumName: 'HrEducationLevel', nullable: true })
  education: EducationLevel | null;
  @ApiProperty({ enum: MARITAL_STATUSES, enumName: 'HrMaritalStatus', nullable: true })
  maritalStatus: MaritalStatus | null;
  @ApiProperty({ type: String, nullable: true }) district: string | null;
  @ApiProperty({ enum: JOB_LEVELS, enumName: 'HrJobLevel', nullable: true })
  jobLevel: JobLevel | null;
  @ApiProperty({ enum: LEFT_REASON_KINDS, enumName: 'HrLeftReasonKind', nullable: true })
  leftReasonKind: LeftReasonKind | null;
  @ApiProperty({ type: [HrStaffChildDto] }) children: HrStaffChildDto[];
}

@ApiSchema({ name: 'HrStaffRequest' })
export class HrStaffRequestDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxName)
  firstName: string;
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxName)
  lastName: string;
  @ApiProperty({ example: '99112233' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  phone: string;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxPosition)
  position: string | null;
  @ApiProperty({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(1) divisionId:
    number | null;
  @ApiProperty({ enum: EMPLOYMENT_TYPES, enumName: 'EmploymentType' })
  @IsIn(EMPLOYMENT_TYPES)
  employmentType: EmploymentType;
  @ApiProperty({ enum: EMPLOYEE_GENDERS, enumName: 'EmployeeGender', nullable: true })
  @IsOptional()
  @IsIn(EMPLOYEE_GENDERS)
  gender: EmployeeGender | null;
  @ApiProperty({ type: String, nullable: true }) @IsOptional() @Matches(DATE) employedOn:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(1) scheduleId:
    number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The first password, when registering; never returned',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string | null;
}

@ApiSchema({ name: 'HrStaffLeftRequest' })
export class HrStaffLeftRequestDto {
  @ApiProperty({ type: String, nullable: true, description: 'null: back at work' })
  @IsOptional()
  @Matches(DATE)
  leftOn: string | null;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxDecisionNote)
  reason: string | null;
  @ApiPropertyOptional({ enum: LEFT_REASON_KINDS, enumName: 'HrLeftReasonKind', nullable: true })
  @IsOptional()
  @IsIn(LEFT_REASON_KINDS)
  reasonKind?: LeftReasonKind | null;
}

@ApiSchema({ name: 'HrStaffPasswordRequest' })
export class HrStaffPasswordRequestDto {
  @ApiProperty() @IsString() @MaxLength(200) password: string;
}

@ApiSchema({ name: 'HrStaffPhotoRequest' })
export class HrStaffPhotoRequestDto {
  @ApiProperty({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(1) fileId:
    number | null;
}

// ── schedules ──────────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrScheduleDay' })
export class HrScheduleDayDto {
  @ApiProperty({ description: 'Monday = 1 … Sunday = 7' }) @IsInt() @Min(1) @Max(7) weekday: number;
  @ApiProperty({ type: String, nullable: true }) @IsOptional() @Matches(TIME) start: string | null;
  @ApiProperty({ type: String, nullable: true }) @IsOptional() @Matches(TIME) end: string | null;
  @ApiProperty({ type: String, nullable: true }) @IsOptional() @Matches(TIME) breakStart:
    string | null;
  @ApiProperty({ type: String, nullable: true }) @IsOptional() @Matches(TIME) breakEnd:
    string | null;
  @ApiProperty({ description: 'FLEXIBLE: the minutes to work; FIXED: computed' })
  @IsInt()
  @Min(0)
  @Max(1440)
  minutes: number;
}

@ApiSchema({ name: 'HrWorkSchedule' })
export class HrWorkScheduleDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: SCHEDULE_KINDS, enumName: 'ScheduleKind' }) kind: ScheduleKind;
  @ApiProperty() color: string;
  @ApiProperty({ type: [HrScheduleDayDto] }) days: HrScheduleDayDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: [Number] }) userIds: number[];
}

@ApiSchema({ name: 'HrWorkScheduleRequest' })
export class HrWorkScheduleRequestDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxScheduleName)
  name: string;
  @ApiProperty({ enum: SCHEDULE_KINDS, enumName: 'ScheduleKind' })
  @IsIn(SCHEDULE_KINDS)
  kind: ScheduleKind;
  @ApiProperty({ example: '#f59e0b' }) @Matches(/^#[0-9a-fA-F]{6}$/) color: string;
  @ApiProperty({ type: [HrScheduleDayDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => HrScheduleDayDto)
  days: HrScheduleDayDto[];
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  userIds: number[];
}

// ── requests ───────────────────────────────────────────────────────────────

@ApiSchema({ name: 'HrRequestType' })
export class HrRequestTypeDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: REQUEST_GROUPS, enumName: 'RequestGroup' }) group: RequestGroup;
  @ApiProperty() color: string;
  @ApiProperty() wholeDays: boolean;
  @ApiProperty() active: boolean;
  @ApiProperty() sort: number;
}

@ApiSchema({ name: 'HrRequestTypeRequest' })
export class HrRequestTypeRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(WORKFORCE_LIMITS.maxName) name: string;
  @ApiProperty({ enum: REQUEST_GROUPS, enumName: 'RequestGroup' })
  @IsIn(REQUEST_GROUPS)
  group: RequestGroup;
  @ApiProperty() @Matches(/^#[0-9a-fA-F]{6}$/) color: string;
  @ApiProperty() @IsBoolean() wholeDays: boolean;
  @ApiProperty() @IsBoolean() active: boolean;
  @ApiProperty() @IsInt() @Min(0) @Max(999) sort: number;
}

@ApiSchema({ name: 'HrTimeRequest' })
export class HrTimeRequestDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty() typeId: number;
  @ApiProperty() typeName: string;
  @ApiProperty({ enum: REQUEST_GROUPS, enumName: 'RequestGroup' }) group: RequestGroup;
  @ApiProperty() color: string;
  @ApiProperty() wholeDays: boolean;
  @ApiProperty() fromDate: string;
  @ApiProperty() toDate: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startsAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt: string | null;
  @ApiProperty({ enum: ATTENDANCE_KINDS, nullable: true }) punchKind: AttendanceKind | null;
  @ApiProperty({ type: Number, nullable: true }) minutes: number | null;
  @ApiProperty() days: number;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: REQUEST_STATUSES, enumName: 'RequestStatus' }) status: RequestStatus;
  @ApiProperty({ type: String, nullable: true }) decidedBy: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) decidedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) decisionNote: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'HrTimeRequestCreate' })
export class HrTimeRequestCreateDto {
  @ApiPropertyOptional({ description: 'HR only: someone else; the app sends none' })
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;
  @ApiProperty() @IsInt() @Min(1) typeId: number;
  @ApiProperty({ example: '2026-11-05' }) @Matches(DATE) fromDate: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @Matches(DATE) toDate?:
    string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;
  @ApiPropertyOptional({ enum: ATTENDANCE_KINDS, nullable: true })
  @IsOptional()
  @IsIn(ATTENDANCE_KINDS)
  punchKind?: AttendanceKind | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxRequestNote)
  note?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsNumberString() lat?:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsNumberString() lng?:
    string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  accuracyM?: number | null;
}

@ApiSchema({ name: 'HrTimeRequestDecision' })
export class HrTimeRequestDecisionDto {
  @ApiProperty() @IsBoolean() approve: boolean;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(WORKFORCE_LIMITS.maxDecisionNote)
  note: string | null;
}

export class HrRequestsQueryDto {
  @ApiPropertyOptional({ enum: REQUEST_STATUSES })
  @IsOptional()
  @IsIn(REQUEST_STATUSES)
  status?: RequestStatus;
  @ApiPropertyOptional() @IsOptional() @Transform(toInt) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toInt) @IsInt() @Min(1) typeId?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string;
}

@ApiSchema({ name: 'HrPendingCount' })
export class HrPendingCountDto {
  @ApiProperty() pending: number;
}

// ── reports ────────────────────────────────────────────────────────────────

export class HrReportQueryDto {
  @ApiProperty() @Matches(DATE) from: string;
  @ApiProperty() @Matches(DATE) to: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toInt) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toInt) @IsInt() @Min(1) divisionId?: number;
}

@ApiSchema({ name: 'HrReportRow' })
export class HrReportRowDto {
  @ApiProperty() date: string;
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) firstName: string | null;
  @ApiProperty({ type: String, nullable: true }) lastName: string | null;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty({ type: Number, nullable: true }) divisionId: number | null;
  @ApiProperty({ type: String, nullable: true }) divisionName: string | null;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ enum: REPORT_STATUSES, enumName: 'HrReportStatus' }) status: ReportStatus;
  @ApiProperty({ type: String, nullable: true }) requestName: string | null;
  @ApiProperty({ type: String, nullable: true }) planStart: string | null;
  @ApiProperty({ type: String, nullable: true }) planEnd: string | null;
  @ApiProperty() flexible: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstIn: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastOut: string | null;
  @ApiProperty({ type: Number, nullable: true }) arrivalDiff: number | null;
  @ApiProperty({ type: Number, nullable: true }) departureDiff: number | null;
  @ApiProperty() breakMinutes: number;
  @ApiProperty() scheduledMinutes: number;
  @ApiProperty() workedInSchedule: number;
  @ApiProperty() workedMinutes: number;
  @ApiProperty() lateMinutes: number;
  @ApiProperty() earlyLeaveMinutes: number;
  @ApiProperty() overtimeMinutes: number;
  @ApiProperty({ type: String, nullable: true }) siteName: string | null;
  @ApiProperty() openIn: boolean;
}

@ApiSchema({ name: 'HrReportTotals' })
export class HrReportTotalsDto {
  @ApiProperty() scheduledMinutes: number;
  @ApiProperty() absentDays: number;
  @ApiProperty() lateMinutes: number;
  @ApiProperty() lateDays: number;
  @ApiProperty() workedMinutes: number;
  @ApiProperty() workedInSchedule: number;
  @ApiProperty() earlyArrivalMinutes: number;
  @ApiProperty() lateDepartureMinutes: number;
  @ApiProperty() overtimeMinutes: number;
  @ApiProperty() leaveDays: number;
}

@ApiSchema({ name: 'HrReport' })
export class HrReportDto {
  @ApiProperty({ type: [HrReportRowDto] }) rows: HrReportRowDto[];
  @ApiProperty({ type: HrReportTotalsDto }) totals: HrReportTotalsDto;
}
