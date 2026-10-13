import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { ProductStatus } from './api';
import { productStage } from './product-stage';

const VARIANT = { ACTIVE: 'success', PENDING: 'warning', INACTIVE: 'secondary' } as const;

/** A product's stage as a pill: green complete, orange waiting for prices, grey not in use. */
export function ProductStageBadge(props: {
  product: { status: ProductStatus; saleReadyAt: string | null };
}) {
  const { t } = useTranslation();
  const stage = productStage(props.product);
  return <Badge variant={VARIANT[stage]}>{t(`catalog.products.status.${stage}`)}</Badge>;
}
