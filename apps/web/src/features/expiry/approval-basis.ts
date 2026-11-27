import type { ExpiryCommerceView, ExpiryReceiptSource } from '@tugeel/shared/expiry';
import type { ExpiryItem } from './api';

/** The facts the operator saw when starting to type an approval. */
export interface ApprovalBasis {
  itemVersion: number;
  sourceVersion: number;
  receiptLineId: number | null;
  costingVersion: number | null;
  liabilityFingerprint: string | null;
  source: ExpiryReceiptSource | null;
  sourceQtyBase: string | null;
  expiryDate: string;
  liableUsers: ExpiryCommerceView['liableUsers'];
}

export function approvalBasisOf(item: ExpiryItem, commerce: ExpiryCommerceView): ApprovalBasis {
  return {
    itemVersion: item.editVersion,
    sourceVersion: commerce.sourceVersion,
    receiptLineId: commerce.source?.receiptLineId ?? null,
    costingVersion: commerce.source?.current?.version ?? null,
    liabilityFingerprint: commerce.liabilityFingerprint,
    source: commerce.source,
    sourceQtyBase: commerce.sourceQtyBase,
    expiryDate: item.expiryDate,
    liableUsers: commerce.liableUsers,
  };
}

export function sameApprovalBasis(
  read: ApprovalBasis,
  item: ExpiryItem,
  commerce: ExpiryCommerceView,
): boolean {
  return (
    read.itemVersion === item.editVersion &&
    read.itemVersion === commerce.itemVersion &&
    read.expiryDate === item.expiryDate &&
    read.sourceVersion === commerce.sourceVersion &&
    read.receiptLineId === (commerce.source?.receiptLineId ?? null) &&
    read.costingVersion === (commerce.source?.current?.version ?? null) &&
    read.liabilityFingerprint === commerce.liabilityFingerprint
  );
}
