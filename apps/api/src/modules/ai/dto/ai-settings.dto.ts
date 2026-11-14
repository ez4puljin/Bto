import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  AI_BUDGET_STATES,
  AI_CONNECTION_SOURCES,
  AI_CONNECTION_STATES,
  AI_PROVIDERS,
  type AiBudgetState,
  type AiConnectionSource,
  type AiConnectionState,
  type AiProvider,
} from '@tugeel/shared/ai';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const URL_RULES = { require_tld: false, require_protocol: true, protocols: ['http', 'https'] };

// ---------------------------------------------------------------------------------------------
// Requests

@ApiSchema({ name: 'AiSettingsUpdateRequest' })
export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ description: 'Off stops every model call' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: AI_PROVIDERS,
    nullable: true,
    description: 'null removes the saved connection: the .env is in force again',
  })
  @IsOptional()
  @IsIn(AI_PROVIDERS)
  provider?: AiProvider | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 120)
  @Matches(/^\S+$/)
  model?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Ollama only' })
  @IsOptional()
  @Transform(trimmed)
  @IsUrl(URL_RULES)
  @MaxLength(300)
  baseUrl?: string | null;

  @ApiPropertyOptional({
    maxLength: 500,
    writeOnly: true,
    description: 'Write only: sealed on the server and never returned',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(8, 500)
  @Matches(/^\S+$/)
  apiKey?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '4', description: 'USD per MTok' })
  @IsOptional()
  @Matches(/^\d{1,6}(\.\d{1,4})?$/)
  priceInputPerMtok?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '20', description: 'USD per MTok' })
  @IsOptional()
  @Matches(/^\d{1,6}(\.\d{1,4})?$/)
  priceOutputPerMtok?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '20.00', description: 'USD' })
  @IsOptional()
  @Matches(/^(?=.*[1-9])\d{1,8}(\.\d{1,2})?$/)
  monthlyBudgetUsd?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  userDailyQuestions?: number | null;
}

@ApiSchema({ name: 'AiSettingsTestRequest' })
export class TestAiSettingsDto {
  @ApiPropertyOptional({ enum: AI_PROVIDERS, description: 'Omitted: the connection in force' })
  @IsOptional()
  @IsIn(AI_PROVIDERS)
  provider?: AiProvider;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 120)
  @Matches(/^\S+$/)
  model?: string;

  @ApiPropertyOptional({ description: 'Ollama only' })
  @IsOptional()
  @Transform(trimmed)
  @IsUrl(URL_RULES)
  @MaxLength(300)
  baseUrl?: string;

  @ApiPropertyOptional({ maxLength: 500, writeOnly: true, description: 'Not saved by this call' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(8, 500)
  @Matches(/^\S+$/)
  apiKey?: string;
}

// ---------------------------------------------------------------------------------------------
// Responses

@ApiSchema({ name: 'AiSettings' })
export class AiSettingsDto {
  @ApiProperty({ enum: AI_CONNECTION_SOURCES }) source: AiConnectionSource;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ enum: AI_PROVIDERS, nullable: true }) provider: AiProvider | null;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  @ApiProperty({ type: String, nullable: true }) baseUrl: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The last characters of the key' })
  keyHint: string | null;
  @ApiProperty({ description: 'A saved key that AI_KEY_SECRET no longer opens' })
  keyUnreadable: boolean;
  @ApiProperty({ description: 'AI_KEY_SECRET is set: a key can be saved here' })
  secretReady: boolean;
  @ApiProperty({ description: 'AI_DATABASE_URL is set: questions can run' })
  readerReady: boolean;
  @ApiProperty({ type: String, nullable: true }) priceInputPerMtok: string | null;
  @ApiProperty({ type: String, nullable: true }) priceOutputPerMtok: string | null;
  @ApiProperty({ type: String, nullable: true }) monthlyBudgetUsd: string | null;
  @ApiProperty({ type: Number, nullable: true }) userDailyQuestions: number | null;
  @ApiProperty({ type: Date, nullable: true }) updatedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) updatedBy: string | null;
}

@ApiSchema({ name: 'AiSettingsTestResult' })
export class AiCheckDto {
  @ApiProperty() ok: boolean;
  @ApiPropertyOptional({ description: 'Why not: TIMEOUT, NETWORK, HTTP, …' }) reason?: string;
  @ApiPropertyOptional() status?: number;
  @ApiPropertyOptional({ description: 'The provider’s short code' }) providerCode?: string;
}

@ApiSchema({ name: 'AiLastFailure' })
export class AiLastFailureDto {
  @ApiProperty() reason: string;
  @ApiProperty({ type: Number, nullable: true }) status: number | null;
  @ApiProperty({ type: String, nullable: true }) providerCode: string | null;
  @ApiProperty() at: Date;
}

@ApiSchema({ name: 'AiConnection' })
export class AiConnectionDto {
  @ApiProperty({ enum: AI_CONNECTION_STATES }) state: AiConnectionState;
  @ApiProperty({ enum: AI_CONNECTION_SOURCES }) source: AiConnectionSource;
  @ApiProperty({ enum: AI_PROVIDERS, nullable: true }) provider: AiProvider | null;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: Number, nullable: true }) status: number | null;
  @ApiProperty({ type: String, nullable: true }) providerCode: string | null;
  @ApiProperty({ type: Date, nullable: true }) checkedAt: Date | null;
  @ApiProperty({ type: AiLastFailureDto, nullable: true }) lastFailure: AiLastFailureDto | null;
}

@ApiSchema({ name: 'AiUsageTotals' })
export class AiUsageTotalsDto {
  @ApiProperty() questions: number;
  @ApiProperty() invoiceChecks: number;
  @ApiProperty({ description: 'Readings of product photos (ADR-0198)' }) productReads: number;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty({ description: 'USD, at each day’s price' }) costUsd: string;
  @ApiProperty({ description: 'Calls with no known price: not in costUsd' }) unpricedCalls: number;
}

@ApiSchema({ name: 'AiUsageBudget' })
export class AiUsageBudgetDto {
  @ApiProperty({ enum: AI_BUDGET_STATES }) state: AiBudgetState;
  @ApiProperty({ type: String, nullable: true }) limitUsd: string | null;
  @ApiProperty() spentUsd: string;
}

@ApiSchema({ name: 'AiUsageByUser' })
export class AiUsageByUserDto {
  @ApiProperty() userId: number;
  @ApiProperty() fullName: string;
  @ApiProperty() questions: number;
  @ApiProperty() invoiceChecks: number;
  @ApiProperty() inputTokens: number;
  @ApiProperty() outputTokens: number;
  @ApiProperty() costUsd: string;
}

@ApiSchema({ name: 'AiUsage' })
export class AiUsageDto {
  @ApiProperty({ type: AiConnectionDto }) connection: AiConnectionDto;
  @ApiProperty({ type: AiUsageTotalsDto }) today: AiUsageTotalsDto;
  @ApiProperty({ type: AiUsageTotalsDto }) month: AiUsageTotalsDto;
  @ApiProperty({ type: AiUsageBudgetDto }) budget: AiUsageBudgetDto;
  @ApiProperty({ type: AiUsageByUserDto, isArray: true }) byUser: AiUsageByUserDto[];
  @ApiProperty({ type: Number, nullable: true }) userDailyQuestions: number | null;
}
