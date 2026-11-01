import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/date-input';
import { todayInUb } from '../day';

/** The day a till record is shown for: today or earlier, never a future day. */
export function DayField(props: { value: string; onChange: (day: string) => void }) {
  const { t } = useTranslation();
  const today = todayInUb();
  return (
    <DateInput
      variant="filter"
      label={t('posKiosk.history.day')}
      className="h-12 shrink-0 rounded-lg text-[0.9375rem]"
      max={today}
      value={props.value}
      onChange={(day) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today) props.onChange(day);
      }}
    />
  );
}
