import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  AI_ANSWER_KINDS,
  AI_ANSWER_STATUSES,
  AI_QUESTION_MAX_LENGTH,
  AI_REPORT_NAME_MAX_LENGTH,
  type AiAnswerKind,
  type AiAnswerStatus,
} from '@tugeel/shared/ai';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { AiColumnKind } from '../sql/ai-reader.service';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const COLUMN_KINDS = ['number', 'text', 'date', 'datetime', 'boolean'] as const;

// ---------------------------------------------------------------------------------------------
// Requests

@ApiSchema({ name: 'AiAskRequest' })
export class AskQuestionDto {
  @ApiPropertyOptional({ description: 'Continue this conversation; omitted: a new one' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number;

  @ApiProperty({ maxLength: AI_QUESTION_MAX_LENGTH, description: 'In Mongolian' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_QUESTION_MAX_LENGTH)
  question: string;
}

@ApiSchema({ name: 'AiReportCreateRequest' })
export class CreateReportDto {
  @ApiProperty({ description: 'One of the caller’s answered questions; its SQL is copied' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  questionId: number;

  @ApiProperty({ maxLength: AI_REPORT_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REPORT_NAME_MAX_LENGTH)
  name: string;
}

@ApiSchema({ name: 'AiReportRenameRequest' })
export class RenameReportDto {
  @ApiProperty({ maxLength: AI_REPORT_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REPORT_NAME_MAX_LENGTH)
  name: string;
}

// ---------------------------------------------------------------------------------------------
// Responses

@ApiSchema({ name: 'AiStatus' })
export class AiStatusDto {
  @ApiProperty({ description: 'Questions can be asked (a provider and the read-only database)' })
  configured: boolean;
  @ApiProperty({ description: 'Saved reports can run (the read-only database)' })
  database: boolean;
  @ApiProperty({ type: String, nullable: true, example: 'openai' }) provider: string | null;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
}

@ApiSchema({ name: 'AiColumn' })
export class AiColumnDto {
  @ApiProperty({ description: 'The output column name (usually Mongolian)' }) name: string;
  @ApiProperty({ enum: COLUMN_KINDS }) kind: AiColumnKind;
}

@ApiSchema({ name: 'AiResult' })
export class AiResultDto {
  @ApiProperty({ type: [AiColumnDto] }) columns: AiColumnDto[];
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string', nullable: true } },
    description: 'Database text per cell: numbers keep their scale, booleans are t / f',
  })
  rows: (string | null)[][];
  @ApiProperty({ description: 'More rows exist than shown (500 on screen)' }) truncated: boolean;
}

@ApiSchema({ name: 'AiQuestion' })
export class AiQuestionDto {
  @ApiProperty() id: number;
  @ApiProperty() conversationId: number;
  @ApiProperty() question: string;
  @ApiProperty({ enum: AI_ANSWER_STATUSES }) status: AiAnswerStatus;
  @ApiProperty({ enum: AI_ANSWER_KINDS, nullable: true }) kind: AiAnswerKind | null;
  @ApiProperty({ type: String, nullable: true, description: 'The query that ran or was refused' })
  sql: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The model’s note, Mongolian' })
  explanation: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Plain text, Mongolian' })
  summary: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'REFUSED / FAILED: a guard reason, an SQLSTATE or CONNECTION',
  })
  errorCode: string | null;
  @ApiProperty({ type: Number, nullable: true }) rowCount: number | null;
  @ApiProperty() truncated: boolean;
  @ApiProperty({ description: 'The model’s first query failed and was rewritten once' })
  repaired: boolean;
  @ApiProperty() createdAt: Date;
}

@ApiSchema({ name: 'AiAnswer' })
export class AiAnswerDto {
  @ApiProperty() conversationId: number;
  @ApiProperty({ type: AiQuestionDto }) question: AiQuestionDto;
  @ApiPropertyOptional({
    type: AiResultDto,
    nullable: true,
    description: 'The rows; absent in an idempotent replay (run the question again)',
  })
  result?: AiResultDto | null;
}

@ApiSchema({ name: 'AiConversation' })
export class AiConversationDto {
  @ApiProperty() id: number;
  @ApiProperty() title: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

@ApiSchema({ name: 'AiConversationPage' })
export class AiConversationPageDto {
  @ApiProperty({ type: [AiConversationDto] }) data: AiConversationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'AiConversationDetail' })
export class AiConversationDetailDto {
  @ApiProperty({ type: AiConversationDto }) conversation: AiConversationDto;
  @ApiProperty({ type: [AiQuestionDto], description: 'Oldest first, without rows' })
  questions: AiQuestionDto[];
}

@ApiSchema({ name: 'AiReportAuthor' })
export class AiReportAuthorDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}

@ApiSchema({ name: 'AiReport' })
export class AiReportDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() sql: string;
  @ApiProperty() sourceQuestionId: number;
  @ApiProperty({ type: AiReportAuthorDto }) createdBy: AiReportAuthorDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ description: 'The caller may rename or delete it' }) canChange: boolean;
}

@ApiSchema({ name: 'AiReportPage' })
export class AiReportPageDto {
  @ApiProperty({ type: [AiReportDto] }) data: AiReportDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}
