import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { badDays, type ScheduleDraft, WEEKDAYS, type Weekday } from './schedule';

/**
 * The working hours, one range a weekday or a day off (ADR-0232): staff answer the phone in these
 * hours, the AI answers outside them.
 */
export function ScheduleEditor(props: {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  checked: boolean;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const bad = props.checked ? badDays(draft) : [];
  const setDay = (day: Weekday, range: ScheduleDraft['days'][Weekday]) =>
    props.onChange({ ...draft, days: { ...draft.days, [day]: range } });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t('phoneAgent.schedule.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('phoneAgent.schedule.hint')}</p>
      <div className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/90">
        {WEEKDAYS.map((day) => {
          const range = draft.days[day];
          const name = t(`phoneAgent.weekdays.${day}`);
          return (
            <div key={day} className="flex flex-wrap items-center gap-3 px-3.5 py-2">
              <span className="w-24 text-sm">{name}</span>
              <Switch
                aria-label={`${name}: ${t('phoneAgent.schedule.works')}`}
                checked={range !== null}
                onCheckedChange={(on) => setDay(day, on ? { from: '09:00', to: '18:00' } : null)}
              />
              {range ? (
                <span className="flex items-center gap-2">
                  <Input
                    type="time"
                    className="w-28 font-mono"
                    aria-label={`${name}: ${t('phoneAgent.schedule.from')}`}
                    value={range.from}
                    onChange={(event) => setDay(day, { ...range, from: event.target.value })}
                  />
                  <span aria-hidden>–</span>
                  <Input
                    type="time"
                    className="w-28 font-mono"
                    aria-label={`${name}: ${t('phoneAgent.schedule.to')}`}
                    value={range.to}
                    onChange={(event) => setDay(day, { ...range, to: event.target.value })}
                  />
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t('phoneAgent.schedule.dayOff')}
                </span>
              )}
              {bad.includes(day) ? (
                <span role="alert" className="text-xs text-destructive">
                  {t('phoneAgent.schedule.badRange')}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
