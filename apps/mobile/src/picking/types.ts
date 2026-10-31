import type { components } from '@tugeel/api-client';

// The picking by warehouse as the server built it (ADR-0126, ADR-0132; `docs/modules/sales.md`).
export type PickWork = components['schemas']['SalesPickWork'];
export type PickPart = components['schemas']['SalesOrderPickPart'];
export type PickOrder = components['schemas']['SalesOrderDetail'];
export type PickLine = components['schemas']['SalesOrderLine'];
export type PickLineInfo = components['schemas']['SalesOrderPickLineInfo'];
export type PickBin = components['schemas']['SalesOrderPickBin'];
export type PickStatus = PickPart['status'];
