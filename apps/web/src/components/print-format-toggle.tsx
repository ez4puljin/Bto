import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/list';
import { PRINT_FORMATS, type PrintFormat } from './print-format';

/** «A4 | 80 мм» beside every print button of the sales screens and on the printable page. */
export function PrintFormatToggle({
  value,
  onChange,
}: {
  value: PrintFormat;
  onChange: (format: PrintFormat) => void;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      options={PRINT_FORMATS}
      value={value}
      label={(format) => t(`sales.print.formats.${format}`)}
      onChange={onChange}
      name={t('sales.print.paper')}
    />
  );
}
