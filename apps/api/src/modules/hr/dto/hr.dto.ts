import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { ATTENDANCE_KINDS, HR_LIMITS } from '@tugeel/shared/hr';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** A coordinate as the phone or the office types it: up to six decimals, a sign allowed. */
const COORDINATE = /^[-+]?\d{1,3}(\.\d{1,9})?$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WORKDAYS = /^[01]{7}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

@ApiSchema({ name: 'WorkSite' })
export class WorkSiteDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Six decimals' }) lat: string;
  @ApiProperty() lng: string;
  @ApiProperty({ description: 'A punch counts within this many metres' }) radiusM: number;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty({ type: String, nullable: true }) branchName: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'WorkSiteRequest' })
export class WorkSiteRequestDto {
  @ApiProperty({ maxLength: HR_LIMITS.maxSiteName })
  @Transform(trimmed)
  @IsString()
  @MaxLength(HR_LIMITS.maxSiteName)
  name: string;
  @ApiProperty({ description: '«47.918412»' }) @IsString() @Matches(COORDINATE) lat: string;
  @ApiProperty() @IsString() @Matches(COORDINATE) lng: string;
  @ApiProperty({ minimum: HR_LIMITS.minRadiusM, maximum: HR_LIMITS.maxRadiusM })
  @IsInt()
  @Min(HR_LIMITS.minRadiusM)
  @Max(HR_LIMITS.maxRadiusM)
  radiusM: number;
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchId: number | null;
}

@ApiSchema({ name: 'WorkSiteArchiveRequest' })
export class WorkSiteArchiveRequestDto {
  @ApiProperty() @IsBoolean() archived: boolean;
}

@ApiSchema({ name: 'HrSchedule' })
export class HrScheduleDto {
  @ApiProperty({ description: 'HH:mm' }) workStart: string;
  @ApiProperty({ description: 'HH:mm' }) workEnd: string;
  @ApiProperty() graceMinutes: number;
  @ApiProperty({ description: 'Seven 0/1 flags, Monday first' }) workdays: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'HrScheduleRequest' })
export class HrScheduleRequestDto {
  @ApiProperty({ description: 'HH:mm' }) @IsString() @Matches(TIME) workStart: string;
  @ApiProperty({ description: 'HH:mm' }) @IsString() @Matches(TIME) workEnd: string;
  @ApiProperty({ minimum: 0, maximum: HR_LIMITS.maxGraceMinutes })
  @IsInt()
  @Min(0)
  @Max(HR_LIMITS.maxGraceMinutes)
  graceMinutes: number;
  @ApiProperty({ description: 'Seven 0/1 flags, Monday first' })
  @IsString()
  @Matches(WORKDAYS)
  workdays: string;
}

@ApiSchema({ name: 'HrEmployee' })
export class HrEmployeeDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ type: [String], description: 'System role codes or custom role names' })
  roles: string[];
  @ApiProperty({ description: 'Counted on the dashboard' }) tracked: boolean;
  @ApiProperty({ type: String, nullable: true }) workStart: string | null;
  @ApiProperty({ type: String, nullable: true }) workEnd: string | null;
  @ApiProperty({ type: Number, nullable: true }) graceMinutes: number | null;
  @ApiProperty({ type: String, nullable: true }) workdays: string | null;
  @ApiProperty({ type: [Number], description: 'Empty = every active site' }) siteIds: number[];
  @ApiProperty({ type: HrScheduleDto, description: 'The schedule that applies' })
  schedule: Pick<HrScheduleDto, 'workStart' | 'workEnd' | 'graceMinutes' | 'workdays'>;
}

@ApiSchema({ name: 'HrEmployeeRequest' })
export class HrEmployeeRequestDto {
  @ApiProperty() @IsBoolean() tracked: boolean;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME)
  workStart: string | null;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME)
  workEnd: string | null;
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(HR_LIMITS.maxGraceMinutes)
  graceMinutes: number | null;
  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(WORKDAYS)
  workdays: string | null;
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  siteIds: number[];
}

@ApiSchema({ name: 'AttendancePunchRequest' })
export class PunchRequestDto {
  @ApiProperty({ enum: ATTENDANCE_KINDS }) @IsIn(ATTENDANCE_KINDS) kind: 'IN' | 'OUT';
  @ApiProperty() @IsString() @Matches(COORDINATE) lat: string;
  @ApiProperty() @IsString() @Matches(COORDINATE) lng: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The fix’s radius in metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyM?: number | null;
}

@ApiSchema({ name: 'AttendanceEvent' })
export class AttendanceEventDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty({ enum: ATTENDANCE_KINDS }) kind: 'IN' | 'OUT';
  @ApiProperty({ type: String, format: 'date-time' }) at: string;
  @ApiProperty({ description: 'The Ulaanbaatar date' }) businessDate: string;
  @ApiProperty({ enum: ['APP', 'OFFICE'] }) source: 'APP' | 'OFFICE';
  @ApiProperty({ type: Number, nullable: true }) siteId: number | null;
  @ApiProperty({ type: String, nullable: true }) siteName: string | null;
  @ApiProperty({ type: String, nullable: true }) lat: string | null;
  @ApiProperty({ type: String, nullable: true }) lng: string | null;
  @ApiProperty({ type: Number, nullable: true }) accuracyM: number | null;
  @ApiProperty({ type: Number, nullable: true }) distanceM: number | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) deleteReason: string | null;
}

@ApiSchema({ name: 'AttendanceSite' })
export class AttendanceSiteDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() lat: string;
  @ApiProperty() lng: string;
  @ApiProperty() radiusM: number;
}

@ApiSchema({ name: 'AttendanceDay' })
export class AttendanceDayDto {
  @ApiProperty() userId: number;
  @ApiProperty() date: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstIn: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastOut: string | null;
  @ApiProperty() workedMinutes: number;
  @ApiProperty() lateMinutes: number;
  @ApiProperty({ description: 'The day ended on an IN («явсан дараагүй»)' }) openIn: boolean;
  @ApiProperty({ enum: ['PRESENT', 'LATE', 'ABSENT', 'OFF'] })
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'OFF';
  @ApiProperty({ type: String, nullable: true }) siteName: string | null;
  @ApiProperty({ enum: ATTENDANCE_KINDS, nullable: true, description: 'IN = still there' })
  state: 'IN' | 'OUT' | null;
}

@ApiSchema({ name: 'AttendanceMonth' })
export class AttendanceMonthDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() workdays: number;
  @ApiProperty() presentDays: number;
  @ApiProperty() lateDays: number;
  @ApiProperty() lateMinutes: number;
  @ApiProperty() workedMinutes: number;
}

@ApiSchema({ name: 'MyAttendance' })
export class MyAttendanceDto {
  @ApiProperty() today: string;
  @ApiProperty({ type: String, format: 'date-time' }) now: string;
  @ApiProperty({ enum: ATTENDANCE_KINDS, nullable: true }) state: 'IN' | 'OUT' | null;
  @ApiProperty({ type: HrScheduleDto })
  schedule: Pick<HrScheduleDto, 'workStart' | 'workEnd' | 'graceMinutes' | 'workdays'>;
  @ApiProperty() tracked: boolean;
  @ApiProperty({ type: [AttendanceSiteDto] }) sites: AttendanceSiteDto[];
  @ApiProperty({ type: [AttendanceEventDto] }) todayEvents: AttendanceEventDto[];
  @ApiProperty({ type: AttendanceDayDto }) day: AttendanceDayDto;
  @ApiProperty({ type: AttendanceMonthDto }) month: AttendanceMonthDto;
}

@ApiSchema({ name: 'AttendanceDayList' })
export class AttendanceDayListDto {
  @ApiProperty({ type: [AttendanceDayDto] }) data: AttendanceDayDto[];
}

@ApiSchema({ name: 'AttendanceEventList' })
export class AttendanceEventListDto {
  @ApiProperty({ type: [AttendanceEventDto] }) data: AttendanceEventDto[];
}

@ApiSchema({ name: 'AttendanceDashboardRow' })
export class AttendanceDashboardRowDto extends AttendanceDayDto {
  @ApiProperty() fullName: string;
  @ApiProperty({ type: [String] }) roles: string[];
  @ApiProperty({ type: HrScheduleDto })
  schedule: Pick<HrScheduleDto, 'workStart' | 'workEnd' | 'graceMinutes' | 'workdays'>;
}

@ApiSchema({ name: 'AttendanceCounts' })
export class AttendanceCountsDto {
  @ApiProperty() expected: number;
  @ApiProperty() present: number;
  @ApiProperty() inNow: number;
  @ApiProperty() late: number;
  @ApiProperty() absent: number;
  @ApiProperty() openIn: number;
  @ApiProperty() off: number;
}

@ApiSchema({ name: 'AttendanceTrendPoint' })
export class AttendanceTrendPointDto {
  @ApiProperty() date: string;
  @ApiProperty() expected: number;
  @ApiProperty() present: number;
  @ApiProperty() late: number;
}

@ApiSchema({ name: 'AttendanceMonthRow' })
export class AttendanceMonthRowDto extends AttendanceMonthDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Minutes since midnight' })
  avgArrivalMinutes: number | null;
}

@ApiSchema({ name: 'AttendanceDashboard' })
export class AttendanceDashboardDto {
  @ApiProperty() date: string;
  @ApiProperty({ type: String, format: 'date-time' }) now: string;
  @ApiProperty({ type: AttendanceCountsDto }) counts: AttendanceCountsDto;
  @ApiProperty({ type: [AttendanceDashboardRowDto] }) rows: AttendanceDashboardRowDto[];
  @ApiProperty({ type: [AttendanceTrendPointDto] }) trend: AttendanceTrendPointDto[];
  @ApiProperty({ type: [AttendanceMonthRowDto] }) month: AttendanceMonthRowDto[];
}

export class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD; today when left out' })
  @IsOptional()
  @IsString()
  @Matches(DATE)
  date?: string;
}

export class DaysQueryDto {
  @ApiProperty({ description: 'YYYY-MM-DD' }) @IsString() @Matches(DATE) from: string;
  @ApiProperty({ description: 'YYYY-MM-DD, at most 62 days after from' })
  @IsString()
  @Matches(DATE)
  to: string;
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}

export class MyDaysQueryDto {
  @ApiProperty({ description: 'YYYY-MM' }) @IsString() @Matches(MONTH) month: string;
}

export class EventsQueryDto {
  @ApiProperty({ type: Number }) @Type(() => Number) @IsInt() @Min(1) userId: number;
  @ApiProperty({ description: 'YYYY-MM-DD' }) @IsString() @Matches(DATE) date: string;
}

@ApiSchema({ name: 'AttendanceEventRequest' })
export class AttendanceEventRequestDto {
  @ApiProperty() @IsInt() @Min(1) userId: number;
  @ApiProperty({ enum: ATTENDANCE_KINDS }) @IsIn(ATTENDANCE_KINDS) kind: 'IN' | 'OUT';
  @ApiProperty({ type: String, format: 'date-time' }) @IsISO8601() at: string;
  @ApiProperty({ maxLength: HR_LIMITS.maxNote })
  @Transform(trimmed)
  @IsString()
  @MaxLength(HR_LIMITS.maxNote)
  note: string;
}

@ApiSchema({ name: 'AttendanceStrikeRequest' })
export class AttendanceStrikeRequestDto {
  @ApiProperty({ maxLength: HR_LIMITS.maxNote })
  @Transform(trimmed)
  @IsString()
  @MaxLength(HR_LIMITS.maxNote)
  reason: string;
}
