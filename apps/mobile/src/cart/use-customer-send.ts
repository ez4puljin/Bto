import { useQueryClient } from '@tanstack/react-query';
import { refreshAfterOrder, type StoreOrder } from '../api/customer';
import { useCustomer } from '../state/session';
import { useShop } from '../state/shop';
import { type CustomerOrderRequest, customerOrderRequestOf } from './cart';
import { type SendResult, useIdempotentSend } from './use-idempotent-send';

export type StoreSendResult = SendResult<StoreOrder>;

/**
 * «Захиалга илгээх» in «Bto300» (ADR-0079 #5): POST /customer-app/orders with an Idempotency-Key
 * kept until an answer; the order lands «Хүлээгдэж буй» on the CUSTOMER_APP channel's stage, and a
 * closed channel answers 409 CUSTOMER_APP_CLOSED.
 */
export function useCustomerSendOrder() {
  const { session } = useCustomer();
  const { cart } = useShop();
  const queryClient = useQueryClient();
  return useIdempotentSend<CustomerOrderRequest, StoreOrder>({
    bodyOf: () => customerOrderRequestOf(cart),
    post: (body, key) =>
      session.client.POST('/api/v1/customer-app/orders', {
        body,
        params: { header: { 'Idempotency-Key': key } },
      }),
    afterSent: () => refreshAfterOrder(queryClient),
  });
}
