import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  KPI_SOURCES,
  type KpiSource,
  PAYROLL_ADJUSTMENT_KINDS,
  type PayrollAdjustmentKind,
  PAYROLL_AMOUNT_PATTERN,
  PAYROLL_LIMITS,
  PAYROLL_MONTH_PATTERN,
  PAYROLL_PERCENT_PATTERN,
  PAYROLL_RUN_STATUSES,
  type PayrollRunStatus,
} from '@tugeel/shared/payroll';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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
const MULTIPLIER = /^\d{1,3}(\.\d{1,2})?$/;
const AMOUNT = { description: 'Money as text, «300000» or «300000.50»', example: '300000.00' };
const PERCENT = { description: 'A percent 0–100 as text, at most two decimals', example: '86.9' };

// ── settings ───────────────────────────────────────────────────────────────

@ApiSchema({ name: 'PayrollTaxCreditBracket' })
export class PayrollTaxCreditBracketDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Monthly taxable income up to this amount (inclusive); null = everything above',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(PAYROLL_AMOUNT_PATTERN)
  upTo: string | null;
  @ApiProperty(AMOUNT) @IsString() @Matches(PAYROLL_AMOUNT_PATTERN) credit: string;
}

@ApiSchema({ name: 'PayrollSettings' })
export class PayrollSettingsDto {
  @ApiProperty(PERCENT) @IsString() @Matches(PAYROLL_PERCENT_PATTERN) latePenaltyPercent: string;
  @ApiProperty(PERCENT) @IsString() @Matches(PAYROLL_PERCENT_PATTERN) employeeSiPercent: string;
  @ApiProperty(PERCENT) @IsString() @Matches(PAYROLL_PERCENT_PATTERN) employerSiPercent: string;
  @ApiProperty(AMOUNT) @IsString() @Matches(PAYROLL_AMOUNT_PATTERN) minimumWage: string;
  @ApiProperty({ description: 'The insurance base is capped at this many minimum wages' })
  @IsString()
  @Matches(MULTIPLIER)
  siCapMultiplier: string;
  @ApiProperty(PERCENT) @IsString() @Matches(PAYROLL_PERCENT_PATTERN) pitPercent: string;
  @ApiProperty({ type: [PayrollTaxCreditBracketDto] })
  @IsArray()
  @ArrayMaxSize(PAYROLL_LIMITS.maxBrackets)
  @ValidateNested({ each: true })
  @Type(() => PayrollTaxCreditBracketDto)
  pitCredits: PayrollTaxCreditBracketDto[];
}

// ── KPI sheets: templates and terms ────────────────────────────────────────

@ApiSchema({ name: 'PayrollKpiItem' })
export class PayrollKpiItemDto {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: KPI_SOURCES, enumName: 'KpiSource' }) source: KpiSource;
  @ApiProperty(AMOUNT) amount: string;
  @ApiProperty() sort: number;
}

@ApiSchema({ name: 'PayrollKpiItemRequest' })
export class PayrollKpiItemRequestDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Send the key of an existing item back so its score survives; omit for a new item',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string | null;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(PAYROLL_LIMITS.maxName) name: string;
  @ApiProperty({ enum: KPI_SOURCES, enumName: 'KpiSource' }) @IsIn(KPI_SOURCES) source: KpiSource;
  @ApiProperty(AMOUNT) @IsString() @Matches(PAYROLL_AMOUNT_PATTERN) amount: string;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number | null;
}

@ApiSchema({ name: 'PayrollKpiTemplate' })
export class PayrollKpiTemplateDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: [PayrollKpiItemDto] }) items: PayrollKpiItemDto[];
  @ApiProperty({ ...AMOUNT, description: 'The sum of the items: what a full score pays' })
  total: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'PayrollKpiTemplateRequest' })
export class PayrollKpiTemplateRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(PAYROLL_LIMITS.maxName) name: string;
  @ApiProperty({ type: [PayrollKpiItemRequestDto] })
  @IsArray()
  @ArrayMaxSize(PAYROLL_LIMITS.maxItems)
  @ValidateNested({ each: true })
  @Type(() => PayrollKpiItemRequestDto)
  items: PayrollKpiItemRequestDto[];
}

@ApiSchema({ name: 'PayrollArchiveRequest' })
export class PayrollArchiveRequestDto {
  @ApiProperty() @IsBoolean() archived: boolean;
}

@ApiSchema({ name: 'PayrollTemplateApplyRequest' })
export class PayrollTemplateApplyRequestDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  userIds: number[];
}

export class PayrollIncludeArchivedQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() includeArchived?: boolean;
}

@ApiSchema({ name: 'PayrollTerms' })
export class PayrollTermsDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: Number, nullable: true }) positionId: number | null;
  @ApiProperty({ type: String, nullable: true }) positionSalaryEffectiveMonth: string | null;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ type: Number, nullable: true }) divisionId: number | null;
  @ApiProperty({ type: String, nullable: true }) divisionName: string | null;
  @ApiProperty({ description: 'The employee has left (a closed account or a leaving date)' })
  left: boolean;
  @ApiProperty({ description: 'True when personal terms or a current position salary exist' })
  hasTerms: boolean;
  @ApiProperty({ description: 'Only active terms put the person on a payroll run' })
  active: boolean;
  @ApiProperty(AMOUNT) baseSalary: string;
  @ApiProperty({ enum: ['POSITION', 'PERSONAL', 'LEGACY'] }) salarySource:
    'POSITION' | 'PERSONAL' | 'LEGACY';
  @ApiProperty({ enum: ['POSITION', 'PERSONAL', 'LEGACY'], nullable: true }) nextSalarySource:
    'POSITION' | 'PERSONAL' | 'LEGACY' | null;
  @ApiProperty({ type: String, nullable: true }) positionBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) positionNextBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) positionNextEffectiveMonth: string | null;

  @ApiProperty({ type: String, nullable: true }) nextBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) nextEffectiveMonth: string | null;
  @ApiProperty() paysSocialInsurance: boolean;
  @ApiProperty({ type: Number, nullable: true }) templateId: number | null;
  @ApiProperty({ type: String, nullable: true }) templateName: string | null;
  @ApiProperty({ type: [PayrollKpiItemDto] }) items: PayrollKpiItemDto[];
  @ApiProperty(AMOUNT) kpiTotal: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'PayrollTermsRequest' })
export class PayrollTermsRequestDto {
  @ApiPropertyOptional({
    ...AMOUNT,
    description:
      'For assigned staff, schedules an employee-only override next month; omit to preserve inheritance',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(PAYROLL_AMOUNT_PATTERN)
  baseSalary?: string;
  @ApiPropertyOptional({
    description: 'Resume the position salary next month; cannot accompany baseSalary',
  })
  @IsOptional()
  @IsBoolean()
  usePositionSalary?: boolean;
  @ApiProperty() @IsBoolean() paysSocialInsurance: boolean;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'The template the sheet came from',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  templateId?: number | null;
  @ApiProperty({ type: [PayrollKpiItemRequestDto] })
  @IsArray()
  @ArrayMaxSize(PAYROLL_LIMITS.maxItems)
  @ValidateNested({ each: true })
  @Type(() => PayrollKpiItemRequestDto)
  items: PayrollKpiItemRequestDto[];
  @ApiProperty() @IsBoolean() active: boolean;
}

/** The caller's own terms: no names, nothing of anyone else. */
@ApiSchema({ name: 'PayrollMyTerms' })
export class PayrollMyTermsDto {
  @ApiProperty({ description: 'False: no pay terms are set for the caller' }) hasTerms: boolean;
  @ApiProperty({ type: Number, nullable: true }) positionId: number | null;
  @ApiProperty({ type: String, nullable: true }) positionSalaryEffectiveMonth: string | null;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty(AMOUNT) baseSalary: string;
  @ApiProperty({ enum: ['POSITION', 'PERSONAL', 'LEGACY'] }) salarySource:
    'POSITION' | 'PERSONAL' | 'LEGACY';
  @ApiProperty({ enum: ['POSITION', 'PERSONAL', 'LEGACY'], nullable: true }) nextSalarySource:
    'POSITION' | 'PERSONAL' | 'LEGACY' | null;
  @ApiProperty({ type: String, nullable: true }) positionBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) positionNextBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) positionNextEffectiveMonth: string | null;

  @ApiProperty({ type: String, nullable: true }) nextBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) nextEffectiveMonth: string | null;
  @ApiProperty() paysSocialInsurance: boolean;
  @ApiProperty({ type: [PayrollKpiItemDto] }) items: PayrollKpiItemDto[];
  @ApiProperty(AMOUNT) kpiTotal: string;
}

// ── advances ───────────────────────────────────────────────────────────────

@ApiSchema({ name: 'PayrollAdvance' })
export class PayrollAdvanceDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty(AMOUNT) amount: string;
  @ApiProperty({ example: '2026-10-15' }) paidOn: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null;
}

@ApiSchema({ name: 'PayrollAdvanceRequest' })
export class PayrollAdvanceRequestDto {
  @ApiProperty() @IsInt() @Min(1) userId: number;
  @ApiProperty({ example: '2026-10', description: 'The month whose payslip deducts it' })
  @Matches(PAYROLL_MONTH_PATTERN)
  month: string;
  @ApiProperty(AMOUNT) @IsString() @Matches(PAYROLL_AMOUNT_PATTERN) amount: string;
  @ApiProperty({ example: '2026-10-15' }) @Matches(DATE) paidOn: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PAYROLL_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PayrollReasonRequest' })
export class PayrollReasonRequestDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(PAYROLL_LIMITS.maxNote)
  reason: string;
}

export class PayrollAdvancesQueryDto {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PAYROLL_MONTH_PATTERN)
  month?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toInt) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() includeVoided?: boolean;
}

// ── runs and payslips ──────────────────────────────────────────────────────

@ApiSchema({ name: 'PayrollPayslipItem' })
export class PayrollPayslipItemDto {
  @ApiProperty() id: number;
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: KPI_SOURCES, enumName: 'KpiSource' }) source: KpiSource;
  @ApiProperty(AMOUNT) amount: string;
  @ApiProperty({ type: String, nullable: true, description: 'null: not scored yet' })
  scorePercent: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ATTENDANCE: attended ÷ workdays as a percent',
  })
  basePercent: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'ATTENDANCE: taken off for late days' })
  penaltyPercent: string | null;
  @ApiProperty(AMOUNT) earned: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) scoredByName: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) scoredAt: string | null;
}

@ApiSchema({ name: 'PayrollPayslipAdjustment' })
export class PayrollPayslipAdjustmentDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: PAYROLL_ADJUSTMENT_KINDS, enumName: 'PayrollAdjustmentKind' })
  kind: PayrollAdjustmentKind;
  @ApiProperty() name: string;
  @ApiProperty(AMOUNT) amount: string;
  @ApiProperty({ description: 'An addition that is part of gross' }) taxable: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PayrollPayslipAdvance' })
export class PayrollPayslipAdvanceDto {
  @ApiProperty() id: number;
  @ApiProperty(AMOUNT) amount: string;
  @ApiProperty() paidOn: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

/** A payslip as its employee reads it (ADR-0235 #9): no employer's cost. */
@ApiSchema({ name: 'PayrollPayslip' })
export class PayrollPayslipDto {
  @ApiProperty() id: number;
  @ApiProperty() runId: number;
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ enum: PAYROLL_RUN_STATUSES, enumName: 'PayrollRunStatus' })
  runStatus: PayrollRunStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) approvedAt: string | null;
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ type: String, nullable: true }) divisionName: string | null;
  @ApiProperty({
    ...AMOUNT,
    description:
      'The fixed salary paid this month: the monthly salary × salaryDays ÷ salaryMonthDays for someone who joined or left inside the month',
  })
  baseSalary: string;
  @ApiProperty({ ...AMOUNT, description: 'The monthly fixed salary of the terms' })
  monthlySalary: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Planned workdays inside the employed span of the month (null: computed before 2026-11-21)',
  })
  salaryDays: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Planned workdays of the whole month; the salary is prorated when salaryDays is fewer',
  })
  salaryMonthDays: number | null;
  @ApiProperty() paysSocialInsurance: boolean;
  @ApiProperty({ description: 'False: attendance is not tracked, the attendance item is full' })
  attendanceMeasured: boolean;
  @ApiProperty({ type: Number, nullable: true }) workdays: number | null;
  @ApiProperty({ type: Number, nullable: true }) attendedDays: number | null;
  @ApiProperty({ type: Number, nullable: true }) lateDays: number | null;
  @ApiProperty({ type: [PayrollPayslipItemDto] }) items: PayrollPayslipItemDto[];
  @ApiProperty({ type: [PayrollPayslipAdjustmentDto] }) adjustments: PayrollPayslipAdjustmentDto[];
  @ApiProperty({ type: [PayrollPayslipAdvanceDto] }) advances: PayrollPayslipAdvanceDto[];
  @ApiProperty() unscoredCount: number;
  @ApiProperty(AMOUNT) kpiTotal: string;
  @ApiProperty(AMOUNT) taxableAdditions: string;
  @ApiProperty({ ...AMOUNT, description: 'Salary + KPI + taxable additions' }) gross: string;
  @ApiProperty(AMOUNT) siBase: string;
  @ApiProperty({ ...AMOUNT, description: 'НДШ, the employee’s share' }) employeeSi: string;
  @ApiProperty(AMOUNT) pitCredit: string;
  @ApiProperty({ ...AMOUNT, description: 'ХХОАТ after the credit' }) pit: string;
  @ApiProperty(AMOUNT) advance: string;
  @ApiProperty(AMOUNT) otherAdditions: string;
  @ApiProperty(AMOUNT) deductions: string;
  @ApiProperty({ ...AMOUNT, description: 'Paid out; negative when advances exceed the pay' })
  net: string;
}

/** A payslip on HR's side: the employer's insurance and the whole cost beside it. */
@ApiSchema({ name: 'PayrollLine' })
export class PayrollLineDto extends PayrollPayslipDto {
  @ApiProperty(AMOUNT) employerSi: string;
  @ApiProperty({ ...AMOUNT, description: 'Gross + untaxed additions + the employer’s insurance' })
  totalCost: string;
}

@ApiSchema({ name: 'PayrollRunTotals' })
export class PayrollRunTotalsDto {
  @ApiProperty(AMOUNT) baseSalary: string;
  @ApiProperty(AMOUNT) kpiTotal: string;
  @ApiProperty(AMOUNT) gross: string;
  @ApiProperty(AMOUNT) employeeSi: string;
  @ApiProperty(AMOUNT) employerSi: string;
  @ApiProperty(AMOUNT) pit: string;
  @ApiProperty(AMOUNT) advance: string;
  @ApiProperty(AMOUNT) otherAdditions: string;
  @ApiProperty(AMOUNT) deductions: string;
  @ApiProperty(AMOUNT) net: string;
  @ApiProperty(AMOUNT) totalCost: string;
}

@ApiSchema({ name: 'PayrollRun' })
export class PayrollRunDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ enum: PAYROLL_RUN_STATUSES, enumName: 'PayrollRunStatus' })
  status: PayrollRunStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: PayrollSettingsDto, description: 'The rates the lines were computed with' })
  settings: PayrollSettingsDto;
  @ApiProperty({ type: String, nullable: true, description: 'The last day of attendance read' })
  attendanceTo: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) computedAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) approvedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) approvedByName: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reopenedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) reopenedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) reopenReason: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ description: 'MANUAL items without a score; approval needs 0' })
  unscoredCount: number;
  @ApiProperty({ type: PayrollRunTotalsDto }) totals: PayrollRunTotalsDto;
}

@ApiSchema({ name: 'PayrollRunDetail' })
export class PayrollRunDetailDto extends PayrollRunDto {
  @ApiProperty({ type: [PayrollLineDto] }) lines: PayrollLineDto[];
}

@ApiSchema({ name: 'PayrollRunCreateRequest' })
export class PayrollRunCreateRequestDto {
  @ApiProperty({ example: '2026-10' }) @Matches(PAYROLL_MONTH_PATTERN) month: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PAYROLL_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PayrollRecomputeRequest' })
export class PayrollRecomputeRequestDto {
  @ApiPropertyOptional({
    description:
      'Also bring the snapshot to the terms as they are now: salaries, items, who is on the run',
  })
  @IsOptional()
  @IsBoolean()
  refreshTerms?: boolean;
}

@ApiSchema({ name: 'PayrollAdjustmentRequest' })
export class PayrollAdjustmentRequestDto {
  @ApiProperty({ enum: PAYROLL_ADJUSTMENT_KINDS, enumName: 'PayrollAdjustmentKind' })
  @IsIn(PAYROLL_ADJUSTMENT_KINDS)
  kind: PayrollAdjustmentKind;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(PAYROLL_LIMITS.maxName) name: string;
  @ApiProperty(AMOUNT) @IsString() @Matches(PAYROLL_AMOUNT_PATTERN) amount: string;
  @ApiPropertyOptional({ description: 'ADDITION only: taxed with the pay (part of gross)' })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;
}

// ── scoring ────────────────────────────────────────────────────────────────

@ApiSchema({ name: 'PayrollScoreEntry' })
export class PayrollScoreEntryDto {
  @ApiProperty() @IsInt() @Min(1) itemId: number;
  @ApiProperty({
    ...PERCENT,
    type: String,
    nullable: true,
    description: 'null takes the score back',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(PAYROLL_PERCENT_PATTERN)
  scorePercent: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PAYROLL_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PayrollScoresRequest' })
export class PayrollScoresRequestDto {
  @ApiProperty({ type: [PayrollScoreEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAYROLL_LIMITS.maxScores)
  @ValidateNested({ each: true })
  @Type(() => PayrollScoreEntryDto)
  scores: PayrollScoreEntryDto[];
}

@ApiSchema({ name: 'PayrollScoringItem' })
export class PayrollScoringItemDto {
  @ApiProperty() itemId: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) scorePercent: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) scoredByName: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) scoredAt: string | null;
}

@ApiSchema({ name: 'PayrollScoringLine' })
export class PayrollScoringLineDto {
  @ApiProperty() lineId: number;
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ type: String, nullable: true }) divisionName: string | null;
  @ApiProperty({ type: [PayrollScoringItemDto] }) items: PayrollScoringItemDto[];
}

/** What a scorer sees: the people and their work-evaluation items, never an amount. */
@ApiSchema({ name: 'PayrollScoring' })
export class PayrollScoringDto {
  @ApiProperty() runId: number;
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ enum: PAYROLL_RUN_STATUSES, enumName: 'PayrollRunStatus' })
  status: PayrollRunStatus;
  @ApiProperty({ type: [PayrollScoringLineDto] }) lines: PayrollScoringLineDto[];
}

@ApiSchema({ name: 'PayrollScoringRun' })
export class PayrollScoringRunDto {
  @ApiProperty() runId: number;
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ enum: PAYROLL_RUN_STATUSES, enumName: 'PayrollRunStatus' })
  status: PayrollRunStatus;
  @ApiProperty() manualCount: number;
  @ApiProperty() unscoredCount: number;
}
