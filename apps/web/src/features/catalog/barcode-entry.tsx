import { classifyBarcode } from '@tugeel/shared/gtin';
import { X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/field-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { layoutDigit } from '@/lib/barcode-keys';
import type { ValidationMessage } from '@/lib/forms';

/**
 * A barcode box: a scanner types the code and presses Enter. The check digit is verified here first;
 * the API checks again and knows which product already owns a code.
 */
export function BarcodeEntry(props: {
  id: string;
  label: string;
  /** Resolves to true when the code was taken, which clears the box. */
  onAdd: (code: string) => boolean | Promise<boolean>;
  /** Whether a lookup key is already on this screen. */
  isRepeated?: (lookupKey: string) => boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<ValidationMessage | undefined>();
  const add = async () => {
    const classified = classifyBarcode(draft);
    if (!classified.ok) {
      setMessage(classified.problem === 'EMPTY' ? undefined : 'validation.barcode');
      return;
    }
    if (props.isRepeated?.(classified.value.lookupKey)) {
      setMessage('validation.barcodeRepeated');
      return;
    }
    setMessage(undefined);
    if (await props.onAdd(classified.value.code)) setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
      return;
    }
    const digit = layoutDigit(event);
    if (digit === null) return;
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    setDraft(`${draft.slice(0, start)}${digit}${draft.slice(end)}`);
  };
  const errorId = `${props.id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          id={props.id}
          aria-label={props.label}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('catalog.product.barcodePlaceholder')}
          disabled={props.disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="button"
          variant="outline"
          disabled={props.disabled}
          onClick={() => void add()}
        >
          {t('catalog.product.addBarcode')}
        </Button>
      </div>
      <FieldError id={errorId} message={message} />
    </div>
  );
}

/** Barcodes entered in a form before the product exists, as removable chips. */
export function BarcodeList(props: {
  id: string;
  label: string;
  value: string[];
  onChange: (codes: string[]) => void;
  isRepeated: (lookupKey: string) => boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <BarcodeEntry
        id={props.id}
        label={props.label}
        isRepeated={props.isRepeated}
        onAdd={(code) => {
          props.onChange([...props.value, code]);
          return true;
        }}
      />
      {props.value.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {props.value.map((code) => (
            <li key={code}>
              <Badge variant="secondary" className="h-6 gap-1 pr-0.5 font-mono">
                {code}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('catalog.product.removeBarcode', { code })}
                  onClick={() => props.onChange(props.value.filter((item) => item !== code))}
                >
                  <X />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
