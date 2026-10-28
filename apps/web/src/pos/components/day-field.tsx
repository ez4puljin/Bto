import { useTranslation } from 'react-i18next';
import { todayInUb } from '../day';

/** The day a till record is shown for: today or earlier, never a future day. */
export function DayField(props: { value: string; onChange: (day: string) => void }) {
  const { t } = useTranslation();
  const today = todayInUb();
  return (
    <label className="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg border border-input bg-background pl-3 text-[15px] shadow-control focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
      <span className="text-muted-foreground">{t('posKiosk.history.day')}</span>
      <input
        type="date"
        className="h-full bg-transparent pr-3 font-mono outline-none"
        max={today}
        value={props.value}
        onChange={(event) => {
          const day = event.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today) props.onChange(day);
        }}
      />
    </label>
  );
}
