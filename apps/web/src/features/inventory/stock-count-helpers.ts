import { formatQty } from '@/lib/money';
import {
  type StockCountPartyKind,
  type StockCountSettlement,
  type StockCountSettlementInput,
} from './counts-api';

// What the count's screens share that is not a component (ADR-0176).

/** A difference with its sign: «+2», «-3», «0». */
export const signedQty = (value: string) =>
  value.startsWith('-') || new RegExp('^0(\\.0+)?$').test(value)
    ? formatQty(value)
    : `+${formatQty(value)}`;

export interface SettlementDraft {
  accountCode: string;
  kind: '' | StockCountPartyKind;
  partyId: number | null;
  name: string;
  charged: boolean;
}

export const draftOf = (settlement: StockCountSettlement | null): SettlementDraft => ({
  accountCode: settlement?.accountCode ?? '',
  kind: settlement?.party?.kind ?? '',
  partyId: settlement?.party?.id ?? null,
  name: settlement?.party?.name ?? '',
  charged: settlement?.charged ?? false,
});

export const inputOf = (draft: SettlementDraft): StockCountSettlementInput => ({
  accountCode: draft.accountCode || null,
  party:
    draft.kind === ''
      ? null
      : draft.kind === 'OTHER'
        ? { kind: 'OTHER', name: draft.name.trim() }
        : { kind: draft.kind, id: draft.partyId },
  charged: draft.kind !== '' && draft.charged,
});

/** A chosen kind names its party. */
export const draftValid = (draft: SettlementDraft): boolean =>
  draft.kind === '' || (draft.kind === 'OTHER' ? draft.name.trim() !== '' : draft.partyId !== null);
