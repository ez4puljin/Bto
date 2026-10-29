import type { components } from '@tugeel/api-client';

// The transfer request contract as the server built it (ADR-0116; `docs/modules/inventory.md`).
export type TransferRequestContext = components['schemas']['TransferRequestContext'];
export type TransferRequestRow = components['schemas']['TransferRequestRow'];
export type TransferRequestRowUnit = components['schemas']['TransferRequestRowUnit'];
export type TransferRequestRowsPage = components['schemas']['TransferRequestRowsPage'];
export type TransferRequestSummary = components['schemas']['TransferRequestSummary'];
export type TransferRequestDetail = components['schemas']['TransferRequestDetail'];
export type TransferRequestGroup = components['schemas']['TransferRequestGroup'];
export type TransferRequestChange = components['schemas']['TransferRequestChange'];
export type TransferRequestSaveResult = components['schemas']['TransferRequestSaveResult'];
export type TransferRequestCreateRequest = components['schemas']['TransferRequestCreateRequest'];
export type TransferDetail = components['schemas']['TransferDetail'];
export type TransferLine = components['schemas']['TransferLine'];
export type TransferCountEntry = components['schemas']['TransferCountEntry'];
export type BarcodeResolution = components['schemas']['BarcodeResolution'];
