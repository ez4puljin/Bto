import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { STATEMENT_KINDS, type StatementKind } from '@tugeel/shared/finance';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROW_TYPES = ['HEADING', 'LINE', 'TOTAL'] as const;
const ACCOUNT_KINDS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;

export class StatementQueryDto {
  @ApiProperty({ example: '2026-01-01' }) @Matches(DATE) from: string;
  @ApiProperty({ example: '2026-12-31' }) @Matches(DATE) to: string;
}

@ApiSchema({ name: 'StatementRowAccount' })
export class StatementRowAccountDto {
  @ApiProperty() accountId: number;
  @ApiProperty({ example: '100101' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ACCOUNT_KINDS }) kind: (typeof ACCOUNT_KINDS)[number];
  @ApiProperty({ type: String, nullable: true, description: 'СТ-1: before the period' })
  opening: string | null;
  @ApiProperty({ example: '1250000.00', description: 'Signed as the row counts it' })
  amount: string;
  @ApiProperty({ description: 'Put on the row by the accountant, not by the default' })
  linked: boolean;
}

@ApiSchema({ name: 'StatementRowResult' })
export class StatementRowResultDto {
  @ApiProperty() opening: string;
  @ApiProperty() amount: string;
}

@ApiSchema({ name: 'StatementRow' })
export class StatementRowDto {
  @ApiProperty({ example: 'A1_1' }) code: string;
  @ApiProperty({ example: '1.1.1', description: "The row's number on the form" }) no: string;
  @ApiProperty({ enum: ROW_TYPES }) type: (typeof ROW_TYPES)[number];
  @ApiProperty({ minimum: 0, maximum: 2 }) level: number;
  @ApiProperty({ type: String, nullable: true }) opening: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Null on a heading' })
  amount: string | null;
  @ApiProperty({ type: [StatementRowAccountDto] }) accounts: StatementRowAccountDto[];
  @ApiProperty({
    type: StatementRowResultDto,
    nullable: true,
    description: "СТ-1's retained earnings: the result not closed yet, inside the amounts",
  })
  result: StatementRowResultDto | null;
}

@ApiSchema({ name: 'StatementDifference' })
export class StatementDifferenceDto {
  @ApiProperty() opening: string;
  @ApiProperty() amount: string;
}

@ApiSchema({ name: 'Statement' })
export class StatementDto {
  @ApiProperty({ enum: STATEMENT_KINDS }) kind: StatementKind;
  @ApiProperty({ type: String, format: 'date' }) from: string;
  @ApiProperty({ type: String, format: 'date' }) to: string;
  @ApiProperty({ type: [StatementRowDto] }) rows: StatementRowDto[];
  @ApiProperty({
    type: StatementDifferenceDto,
    nullable: true,
    description: 'СТ-1: assets minus liabilities and equity; zero when it balances',
  })
  difference: StatementDifferenceDto | null;
}

@ApiSchema({ name: 'StatementLinkRequest' })
export class StatementLinkDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'I19',
    description: "A row of the account's statement; null returns it to the default row",
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  rowCode?: string | null;
}
