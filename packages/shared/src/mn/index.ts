/**
 * The Mongolian localisation layer (ADR-0074): tax kinds, codes and the tax-inclusive split, the
 * Erkhet-style chart template, the document-number defaults and the e-Barimt shapes. Pure rules and
 * data for every system (Bto, the store edge, later the PMS); the Finance Core never imports it and
 * gets codes, rates and the chart as data. Imports only money, time and taxpayer (lint, ADR-0074 #2).
 */
export {
  ACCOUNT_KINDS,
  type AccountKind,
  CHART_ROLES,
  CHART_TEMPLATE,
  type ChartRole,
  type ChartTemplateAccount,
} from './chart';
export {
  buildPosapiReceipt,
  CLASSIFICATION_CODE_PATTERN,
  DDTD_PATTERN,
  DISTRICT_CODE_PATTERN,
  EBARIMT_BUILD_ERRORS,
  EBARIMT_PAYMENT_CODES,
  EBARIMT_STATUSES,
  EBARIMT_TAX_TYPES,
  EbarimtBuildError,
  type EbarimtBuildErrorCode,
  type EbarimtLineInput,
  type EbarimtPaymentCode,
  type EbarimtReceiptInput,
  type EbarimtStatus,
  type EbarimtTaxType,
  POSAPI_DATE_PATTERN,
  POSAPI_RECEIPT_TYPES,
  POSAPI_RESULT_STATUSES,
  type PosapiItem,
  type PosapiReceiptRequest,
  type PosapiReceiptType,
  type PosapiResultStatus,
  type PosapiSubReceipt,
  posapiJson,
  RECEIPT_TYPES,
  type ReceiptType,
  TAX_PRODUCT_CODE_PATTERN,
} from './ebarimt';
export { NUMBER_DEFAULTS, type NumberFormat } from './numbers';
export {
  type CityTaxCode,
  cityTaxCode,
  TAX_KINDS,
  type TaxKind,
  type TaxSplit,
  taxSplit,
  VAT_TAX_CODES,
  type VatTaxCode,
} from './tax';
