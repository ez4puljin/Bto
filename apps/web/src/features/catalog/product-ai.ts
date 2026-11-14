import type { ProblemDetails } from '@tugeel/api-client';
import type { UseFieldArrayReplace, UseFormReturn } from 'react-hook-form';
import type { RegistrationValues } from './registration-schema';
import type { ProductAiProposal } from './use-product-ai';

/**
 * Fills the registration form with a proposal (ADR-0198). Only what the model proposed is
 * written: a field it left empty keeps what the registrar had (the category, supplier and unit
 * stay from the product before). A barcode a product already carries is left out, since saving it
 * would be refused; the panel names that product instead. The category goes first, because it
 * suggests the code.
 */
export function applyProposal(
  form: UseFormReturn<RegistrationValues>,
  replaceUnits: UseFieldArrayReplace<RegistrationValues, 'units'>,
  proposal: ProductAiProposal,
): void {
  const set = { shouldDirty: true, shouldValidate: true } as const;
  const taken = new Set(proposal.existing.map((entry) => entry.code));
  const free = (codes: readonly string[]) => codes.filter((code) => !taken.has(code));

  if (proposal.categoryId !== null) form.setValue('categoryId', String(proposal.categoryId), set);
  if (proposal.name !== null) form.setValue('name', proposal.name, set);
  if (proposal.baseUomId !== null) form.setValue('baseUomId', String(proposal.baseUomId), set);
  if (proposal.boxFactor !== null) form.setValue('boxFactor', proposal.boxFactor, set);
  if (proposal.weightKg !== null) form.setValue('weightKg', proposal.weightKg, set);
  const baseBarcodes = free(proposal.baseBarcodes);
  if (baseBarcodes.length > 0) form.setValue('baseBarcodes', baseBarcodes, set);
  const boxBarcodes = free(proposal.boxBarcodes);
  if (boxBarcodes.length > 0) form.setValue('boxBarcodes', boxBarcodes, set);
  if (proposal.units.length > 0) {
    replaceUnits(
      proposal.units.map((unit) => ({
        uomId: String(unit.uomId),
        factorToBase: unit.factorToBase,
        barcodes: free(unit.barcodes),
      })),
    );
  }
  if (proposal.supplier !== null) form.setValue('supplier', proposal.supplier, set);
}

export type PictureFailure = 'notSet' | 'credit' | 'badKey' | 'rateLimit' | 'timeout' | 'other';

/** Which text explains why a picture was not cut out: the service's code and status, never its words. */
export function pictureFailureOf(problem: ProblemDetails): PictureFailure {
  if (problem.code === 'PICTURE_NOT_CONFIGURED') return 'notSet';
  if (problem.code !== 'PICTURE_PROVIDER_FAILED') return 'other';
  const { status, providerCode, reason } = problem.params ?? {};
  if (status === 402 || providerCode === 'insufficient_credits') return 'credit';
  if (status === 401 || status === 403 || providerCode === 'auth_failed') return 'badKey';
  if (status === 429) return 'rateLimit';
  if (reason === 'TIMEOUT' || reason === 'NETWORK') return 'timeout';
  return 'other';
}
