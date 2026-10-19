import { useTranslation } from 'react-i18next';
import type { PendingSendWords } from '../ui/pending-send';

/** «Bto300»'s words for an unanswered send: its orders are on «Захиалга». */
export function usePendingWords(): PendingSendWords {
  const { t } = useTranslation();
  return {
    unknownHint: t('mobile.customer.cart.pending.unknownHint'),
    checkOrders: t('mobile.customer.cart.pending.checkOrders'),
    forgetHint: t('mobile.customer.cart.pending.forgetHint'),
  };
}
