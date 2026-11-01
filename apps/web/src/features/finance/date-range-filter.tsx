import { DateInput } from '@/components/date-input';

/**
 * A date range in a filter bar (ADR-0066): one pill «Огноо [from] – [to]» instead of two, so a busy
 * bar keeps one line at 1366px. Tinted while it narrows the list; each date keeps its own name
 * («Эхлэх огноо», «Дуусах огноо») for screen readers and tests, and an empty date clears its end.
 */
export function DateRangeFilter(props: {
  label: string;
  fromLabel: string;
  toLabel: string;
  from: string | undefined;
  to: string | undefined;
  onFrom: (value: string | undefined) => void;
  onTo: (value: string | undefined) => void;
}) {
  const active = Boolean(props.from || props.to);
  return (
    <div
      role="group"
      aria-label={props.label}
      data-active={active ? 'true' : undefined}
      className="group inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-border bg-background pl-3 text-[0.8125rem] font-medium shadow-control focus-within:border-ring focus-within:ring-1 focus-within:ring-ring hover:bg-accent data-[active=true]:border-transparent data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground"
    >
      <span className="mr-1 text-muted-foreground group-data-[active=true]:text-secondary-foreground">
        {props.label}
      </span>
      <DateInput
        variant="bare"
        aria-label={props.fromLabel}
        value={props.from}
        max={props.to}
        onChange={(value) => props.onFrom(value || undefined)}
      />
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
      <DateInput
        variant="bare"
        aria-label={props.toLabel}
        className="pr-1"
        value={props.to}
        min={props.from}
        onChange={(value) => props.onTo(value || undefined)}
      />
    </div>
  );
}
