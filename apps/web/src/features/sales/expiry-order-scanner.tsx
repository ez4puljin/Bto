import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { problemFromError, settle, unwrap } from '@/lib/problem';

export interface ExpiryOrderPick {
  productId: number;
  sku: string;
  name: string;
  unitId: number;
  unitName: string;
  expiryBarcode: string;
}

/** The resolver verifies the chosen pipeline before an expiry variant is added to a draft. */
export function ExpiryOrderScanner(props: {
  pipelineId: number | null;
  onPick: (line: ExpiryOrderPick) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookup = useMutation({
    mutationFn: async (barcode: string) => {
      const offer = unwrap(
        await api.GET('/api/v1/expiry/barcodes/{barcode}', {
          params: { path: { barcode }, query: { pipelineId: props.pipelineId ?? 0 } },
        }),
      ) as { productId: number; productUnitId: number; barcode: string };
      const product = unwrap(
        await api.GET('/api/v1/products/{id}', { params: { path: { id: offer.productId } } }),
      );
      const unit = product.units.find((row) => row.id === offer.productUnitId);
      if (!unit) throw new Error('expiry unit unavailable');
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitId: unit.id,
        unitName: unit.uomName,
        expiryBarcode: offer.barcode,
      };
    },
    onSuccess: props.onPick,
  });
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <ScanBox
        letters
        compact
        label={t('expiry.commerce.scan')}
        placeholder={t('expiry.commerce.scan')}
        disabled={props.pipelineId === null || lookup.isPending}
        onScan={(code) => void settle(lookup.mutateAsync(code))}
      />
      <ProblemAlert problem={problemFromError(lookup.error)} />
    </div>
  );
}
