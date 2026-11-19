import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ERKHET_LEDGER_FAILURES,
  ERKHET_LEDGER_LIMITS,
  ERKHET_LEDGER_REFUSALS,
  ERKHET_LEDGER_RUN_KINDS,
  ERKHET_LEDGER_SIDES,
  ERKHET_OWN_DOCUMENT_BLOCKERS,
  ERKHET_OWN_DOCUMENT_CHOICES,
  ERKHET_RUN_STATUSES,
  type ErkhetLedgerFailure,
  type ErkhetLedgerRefusal,
  type ErkhetLedgerRunKind,
  type ErkhetLedgerSide,
  type ErkhetOwnDocumentBlocker,
  type ErkhetOwnDocumentChoice,
  type ErkhetRunStatus,
} from '@tugeel/shared/erkhet';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import type { OwnDocumentKind } from '../../fin-bridge';
import { ERKHET_RUN_TRIGGERS, type ErkhetRunTrigger } from '../schema';
import type {
  ErkhetLedgerOverview,
  ErkhetOwnDocument,
  ErkhetLedgerParty,
  ErkhetLedgerRun,
  LedgerSettingsRow,
  LedgerStart,
} from '../services/erkhet-ledger.service';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};
const ACCOUNT = /^\d{3,20}$/;
const OWN_KINDS: readonly OwnDocumentKind[] = ['VOUCHER', 'JOURNAL', 'OTHER'];

@ApiSchema({ name: 'ErkhetLedgerSettingsUpdateRequest' })
export class UpdateErkhetLedgerSettingsDto {
  @ApiPropertyOptional({ description: "Erkhet's account of the customers' receivables" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(ACCOUNT)
  receivableAccount?: string;

  @ApiPropertyOptional({ description: "Erkhet's account of the suppliers' payables" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(ACCOUNT)
  payableAccount?: string;

  @ApiPropertyOptional({ format: 'date', description: 'The first day copied line by line' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Length(10, 10)
  startDate?: string;
}

@ApiSchema({ name: 'ErkhetLedgerSettings' })
export class ErkhetLedgerSettingsDto {
  @ApiProperty() receivableAccount: string;
  @ApiProperty() payableAccount: string;
  @ApiProperty({ format: 'date' }) startDate: string;
  @ApiProperty({ description: 'The night keeps the books up with Erkhet' }) posting: boolean;
}

@ApiSchema({ name: 'ErkhetLedgerAccountSummary' })
export class ErkhetLedgerAccountSummaryDto {
  @ApiProperty({ description: "Erkhet's account code" }) account: string;
  @ApiProperty({ enum: ERKHET_LEDGER_SIDES }) side: ErkhetLedgerSide;
  @ApiProperty() trs: number;
  @ApiProperty() lines: number;
  @ApiProperty({ description: 'MNT, debit − credit before the start date' }) opening: string;
  @ApiProperty({ description: 'MNT' }) debit: string;
  @ApiProperty({ description: 'MNT' }) credit: string;
  @ApiProperty({ description: 'MNT, opening + debit − credit' }) closing: string;
  @ApiProperty() openingParties: number;
}

@ApiSchema({ name: 'ErkhetLedgerCounts' })
export class ErkhetLedgerCountsDto {
  @ApiProperty() post: number;
  @ApiProperty() revise: number;
  @ApiProperty() reverse: number;
  @ApiProperty() unmatched: number;
}

@ApiSchema({ name: 'ErkhetLedgerOwnTotal' })
export class ErkhetLedgerOwnTotalDto {
  @ApiProperty() count: number;
  @ApiProperty({ description: 'MNT, debit − credit' }) total: string;
}

@ApiSchema({ name: 'ErkhetLedgerDone' })
export class ErkhetLedgerDoneDto {
  @ApiProperty() posted: number;
  @ApiProperty() reversed: number;
  @ApiProperty({ description: "Left as they were: Bto's own allocation holds their item" })
  blocked: number;

  @ApiProperty({ description: "Bto's own documents reversed with the run" }) ownReversed: number;
  @ApiProperty({ description: 'Transaction addresses found in the run' }) links: number;
}

@ApiSchema({ name: 'ErkhetLedgerSummary' })
export class ErkhetLedgerSummaryDto {
  @ApiProperty({ type: [ErkhetLedgerAccountSummaryDto] }) accounts: ErkhetLedgerAccountSummaryDto[];
  @ApiProperty({ type: ErkhetLedgerCountsDto }) trs: ErkhetLedgerCountsDto;
  @ApiProperty({ type: ErkhetLedgerCountsDto }) openings: ErkhetLedgerCountsDto;
  @ApiProperty() unmatchedParties: number;
  @ApiProperty({ type: ErkhetLedgerOwnTotalDto }) ownDocuments: ErkhetLedgerOwnTotalDto;
  @ApiProperty({ type: ErkhetLedgerDoneDto, nullable: true }) done: ErkhetLedgerDoneDto | null;
}

@ApiSchema({ name: 'ErkhetLedgerRun' })
export class ErkhetLedgerRunDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ERKHET_LEDGER_RUN_KINDS }) kind: ErkhetLedgerRunKind;
  @ApiProperty({ enum: ERKHET_RUN_STATUSES }) status: ErkhetRunStatus;
  @ApiProperty({ enum: ERKHET_RUN_TRIGGERS }) trigger: ErkhetRunTrigger;
  @ApiProperty({ type: String, nullable: true }) startedBy: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt: string | null;
  @ApiProperty({ enum: ERKHET_LEDGER_FAILURES, nullable: true })
  failure: ErkhetLedgerFailure | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
    description: 'What the failure names: a month, an account code, an error code of the books',
  })
  failureDetail: Record<string, string> | null;

  @ApiProperty({ enum: ERKHET_OWN_DOCUMENT_CHOICES, nullable: true })
  ownChoice: ErkhetOwnDocumentChoice | null;

  @ApiProperty() ownReversed: number;
  @ApiProperty({ type: ErkhetLedgerSummaryDto, nullable: true })
  summary: ErkhetLedgerSummaryDto | null;
}

@ApiSchema({ name: 'ErkhetLedgerOverview' })
export class ErkhetLedgerOverviewDto {
  @ApiProperty({ description: 'A complete sign-in is saved' }) configured: boolean;
  @ApiProperty() receivableAccount: string;
  @ApiProperty() payableAccount: string;
  @ApiProperty({ format: 'date' }) startDate: string;
  @ApiProperty({ description: '«Bto-д оруулах» ran: the night keeps up' }) posting: boolean;
  @ApiProperty() nightly: boolean;
  @ApiProperty({ type: ErkhetLedgerRunDto, nullable: true }) active: ErkhetLedgerRunDto | null;
  @ApiProperty({ type: ErkhetLedgerRunDto, nullable: true }) latest: ErkhetLedgerRunDto | null;
  @ApiProperty({ type: ErkhetLedgerRunDto, nullable: true }) failed: ErkhetLedgerRunDto | null;
  @ApiProperty({ description: 'A fresh check stands: the first post may start' }) checked: boolean;
  @ApiProperty({ description: 'Copies in the books' }) posted: number;
  @ApiProperty({ description: 'Copies a person has to look at' }) blocked: number;
}

@ApiSchema({ name: 'ErkhetLedgerStartRequest' })
export class StartErkhetLedgerRunDto {
  @ApiProperty({ enum: ERKHET_LEDGER_RUN_KINDS })
  @IsIn(ERKHET_LEDGER_RUN_KINDS)
  kind: ErkhetLedgerRunKind;

  @ApiPropertyOptional({
    enum: ERKHET_OWN_DOCUMENT_CHOICES,
    description: "A post only: what to do with Bto's own documents on the copied accounts",
  })
  @IsOptional()
  @IsIn(ERKHET_OWN_DOCUMENT_CHOICES)
  ownDocuments?: ErkhetOwnDocumentChoice;

  @ApiPropertyOptional({ description: 'The reason written on each reversal of them' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@ApiSchema({ name: 'ErkhetLedgerStartResult' })
export class ErkhetLedgerStartDto {
  @ApiProperty() started: boolean;
  @ApiProperty({ enum: ERKHET_LEDGER_REFUSALS, nullable: true })
  refusal: ErkhetLedgerRefusal | null;

  @ApiProperty({ type: ErkhetLedgerRunDto, nullable: true }) run: ErkhetLedgerRunDto | null;
}

export class ErkhetLedgerPartiesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'One of the two copied Erkhet account codes' })
  @IsOptional()
  @IsString()
  @Matches(ACCOUNT)
  account?: string;

  @ApiPropertyOptional({ description: 'true: only parties Bto does not have' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  unmatched?: boolean;

  @ApiPropertyOptional({ description: 'A code or a part of a name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiSchema({ name: 'ErkhetLedgerParty' })
export class ErkhetLedgerPartyDto {
  @ApiProperty() account: string;
  @ApiProperty({ enum: ERKHET_LEDGER_SIDES }) side: ErkhetLedgerSide;
  @ApiProperty({ description: 'Empty for lines Erkhet shows without a party' }) code: string;
  @ApiProperty({ description: 'As Erkhet names it' }) name: string;
  @ApiProperty({ type: Number, nullable: true, description: 'The customer or supplier in Bto' })
  btoId: number | null;

  @ApiProperty() lines: number;
  @ApiProperty({ description: 'MNT' }) opening: string;
  @ApiProperty({ description: 'MNT' }) debit: string;
  @ApiProperty({ description: 'MNT' }) credit: string;
  @ApiProperty({ description: 'MNT' }) closing: string;
}

@ApiSchema({ name: 'ErkhetLedgerPartyPage' })
export class ErkhetLedgerPartyPageDto {
  @ApiProperty({ type: [ErkhetLedgerPartyDto] }) data: ErkhetLedgerPartyDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'ErkhetLedgerOwnDocument' })
export class ErkhetLedgerOwnDocumentDto {
  @ApiProperty({ type: Number, nullable: true }) documentId: number | null;
  @ApiProperty() entryId: number;
  @ApiProperty() number: string;
  @ApiProperty({ format: 'date' }) date: string;
  @ApiProperty({ enum: ERKHET_LEDGER_SIDES }) side: ErkhetLedgerSide;
  @ApiProperty({ enum: OWN_KINDS }) kind: OwnDocumentKind;

  @ApiProperty({
    enum: ERKHET_OWN_DOCUMENT_BLOCKERS,
    nullable: true,
    description: 'Why it cannot be reversed from this page; null when it can',
  })
  blocker: ErkhetOwnDocumentBlocker | null;

  @ApiProperty({ type: String, nullable: true }) partyName: string | null;
  @ApiProperty({ description: 'MNT, debit − credit on the account' }) amount: string;
}

@ApiSchema({ name: 'ErkhetLedgerOwnDocuments' })
export class ErkhetLedgerOwnDocumentsDto {
  @ApiProperty({ type: [ErkhetLedgerOwnDocumentDto] }) data: ErkhetLedgerOwnDocumentDto[];
  @ApiProperty({ description: 'MNT, of every such document' }) total: string;
  @ApiProperty({ description: 'More exist than the list holds' }) truncated: boolean;
}

export class ErkhetLedgerLinksQueryDto {
  @ApiProperty({
    description: `Copied transactions as «account:transaction», comma separated, at most ${ERKHET_LEDGER_LIMITS.maxLinkKeys}`,
  })
  @IsString()
  @Length(1, 8_000)
  @Matches(/^\d{1,20}:\d{1,18}(,\d{1,20}:\d{1,18})*$/)
  keys: string;
}

@ApiSchema({ name: 'ErkhetLedgerLink' })
export class ErkhetLedgerLinkDto {
  @ApiProperty() key: string;
  @ApiProperty({ description: 'The address to open in Erkhet' }) url: string;
  @ApiProperty({ description: 'false: the journal list of that day, not the transaction itself' })
  exact: boolean;
}

// ------------------------------------------------------------------------------------------------

export function toLedgerSettingsDto(row: LedgerSettingsRow): ErkhetLedgerSettingsDto {
  return {
    receivableAccount: row.receivableAccount,
    payableAccount: row.payableAccount,
    startDate: row.startDate,
    posting: row.posting,
  };
}

export function toLedgerRunDto(run: ErkhetLedgerRun): ErkhetLedgerRunDto {
  return {
    ...run,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function toLedgerOverviewDto(overview: ErkhetLedgerOverview): ErkhetLedgerOverviewDto {
  return {
    ...overview,
    active: overview.active ? toLedgerRunDto(overview.active) : null,
    latest: overview.latest ? toLedgerRunDto(overview.latest) : null,
    failed: overview.failed ? toLedgerRunDto(overview.failed) : null,
  };
}

export function toLedgerStartDto(start: LedgerStart): ErkhetLedgerStartDto {
  return {
    started: start.started,
    refusal: start.refusal,
    run: start.run ? toLedgerRunDto(start.run) : null,
  };
}

export function toLedgerPartyDto(party: ErkhetLedgerParty): ErkhetLedgerPartyDto {
  return {
    ...party,
    opening: party.opening.toFixed(2),
    debit: party.debit.toFixed(2),
    credit: party.credit.toFixed(2),
    closing: party.closing.toFixed(2),
  };
}

export function toOwnDocumentDto(document: ErkhetOwnDocument): ErkhetLedgerOwnDocumentDto {
  return {
    documentId: document.documentId,
    entryId: document.entryId,
    number: document.number,
    date: document.date,
    side: document.side,
    kind: document.kind,
    blocker: document.blocker,
    partyName: document.partyName,
    amount: document.amount.toFixed(2),
  };
}
