import { plainDecimal } from '@/lib/money';
import type { SalesOrder, SalesOrderRequest } from './api';

/**
 * The whole order as `PUT /sales-orders/:id` takes it, changed by `patch` (ADR-0059): the panel saves
 * its header and its products apart, each sending the other part as it is stored.
 */
export function orderRequestOf(
  order: SalesOrder,
  patch: Partial<SalesOrderRequest> = {},
): SalesOrderRequest {
  return {
    customerId: order.customerId,
    // A save over a change made meanwhile is refused (ORDER_CHANGED) instead of undoing it.
    expectedUpdatedAt: order.updatedAt,
    pipelineId: null,
    stageId: null,
    fulfilment: order.fulfilment,
    deliveryDate: order.deliveryDate,
    addressId: order.fulfilment === 'DELIVERY' ? order.addressId : null,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
    paymentMethod: order.paymentMethod,
    note: order.note,
    lines: order.lines.map((line) => ({
      productUnitId: line.productUnitId,
      qty: plainDecimal(line.qty),
    })),
    ...patch,
  };
}
