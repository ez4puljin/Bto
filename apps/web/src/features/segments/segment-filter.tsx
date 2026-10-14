import type { SegmentEntity } from '@tugeel/shared/segments';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { useSegments } from './api';

/**
 * «Бүх сегмент»: narrows a customer or supplier list to a saved segment (ADR-0049). Hidden while
 * the entity has no segments, unless the URL already names one.
 */
export function SegmentFilter(props: {
  entity: SegmentEntity;
  value: number | undefined;
  onChange: (segmentId: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const segments = useSegments(props.entity);
  const rows = segments.data ?? [];
  if (rows.length === 0 && props.value === undefined) return null;
  return (
    <NativeSelect
      variant="filter"
      aria-label={t('catalog.products.filters.fields.segment')}
      value={props.value === undefined ? '' : String(props.value)}
      onChange={(event) =>
        props.onChange(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)
      }
    >
      <option value="">{t('segments.allSegments')}</option>
      {rows.map((row) => (
        <option key={row.id} value={String(row.id)}>
          {row.name}
        </option>
      ))}
    </NativeSelect>
  );
}
