import { useQueryClient } from '@tanstack/react-query';
import type { RepOrder } from '../api/rep';
import { useSignedIn } from '../state/session';
import { useShop } from '../state/shop';
import { type OrderRequest, orderRequestOf } from './cart';
import { type SendResult as AnySendResult, useIdempotentSend } from './use-idempotent-send';

export type SendResult = AnySendResult<RepOrder>;

/** The rep's send (ADR-0061 #8): POST /sales-rep/orders on the stage chosen in the settings. */
export function useSendOrder() {
  const { session } = useSignedIn();
  const { cart, stageId } = useShop();
  const queryClient = useQueryClient();
  return useIdempotentSend<OrderRequest, RepOrder>({
    bodyOf: () => (stageId === null ? null : orderRequestOf(cart, stageId)),
    post: (body, key) =>
      session.client.POST('/api/v1/sales-rep/orders', {
        body,
        params: { header: { 'Idempotency-Key': key } },
      }),
    afterSent: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rep', 'orders'] });
      await queryClient.invalidateQueries({ queryKey: ['rep', 'products'] });
      // The store map's red and green: the store just ordered from turns green.
      await queryClient.invalidateQueries({ queryKey: ['rep', 'map'] });
      // And its order history on the store card.
      await queryClient.invalidateQueries({ queryKey: ['rep', 'store-orders'] });
    },
  });
}
