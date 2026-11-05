import { type ComponentProps, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Digits and one point, at most two decimals: what a money field may hold. */
function cleanMoney(text: string): string {
  const kept = text.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = kept.split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  return rest.length > 0 ? `${digits}.${rest.join('').slice(0, 2)}` : digits;
}

/** «1234567.5» as «1,234,567.5»; never a number, so nothing is rounded. */
function groupMoney(raw: string): string {
  const [whole = '', decimals] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals === undefined ? grouped : `${grouped}.${decimals}`;
}

/** The caret after the same count of digits and points, whatever the commas did. */
function placeCaret(input: HTMLInputElement, shown: string, digitsBefore: number) {
  let left = digitsBefore;
  let position = 0;
  while (position < shown.length && left > 0) {
    if (shown[position] !== ',') left -= 1;
    position += 1;
  }
  input.setSelectionRange(position, position);
}

/**
 * A money field whose thousands appear as they are typed (owner 2026-11-05, ADR-0152): the page holds
 * the plain «1000000» and sees «1,000,000». The caret stays after the same digit.
 */
export function MoneyInput({
  ref,
  value,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (raw: string) => void;
}) {
  const box = useRef<HTMLInputElement | null>(null);
  /** How many digits and points stood before the caret at the last keystroke. */
  const before = useRef<number | null>(null);
  const shown = groupMoney(value);
  useImperativeHandle(ref, () => box.current as HTMLInputElement, []);

  useLayoutEffect(() => {
    if (!box.current || before.current === null) return;
    placeCaret(box.current, shown, before.current);
    before.current = null;
  }, [shown]);

  return (
    <Input
      {...props}
      ref={box}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('text-right font-mono', className)}
      value={shown}
      onChange={(event) => {
        const typed = event.target.value;
        const caret = event.target.selectionStart ?? typed.length;
        const digitsBefore = typed.slice(0, caret).replace(/[^\d.]/g, '').length;
        const raw = cleanMoney(typed);
        if (raw === value) {
          // A letter or a lone comma: nothing changes, so no render puts the caret back.
          event.target.value = shown;
          placeCaret(event.target, shown, digitsBefore);
          return;
        }
        before.current = digitsBefore;
        onValueChange(raw);
      }}
    />
  );
}
