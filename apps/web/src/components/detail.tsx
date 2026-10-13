import { Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A record's card, read first and edited in place (ADR-0042): «Засах» (named «Засах: {title}»)
 * switches it to its form; the form's Cancel or a successful save returns to reading. Entering the
 * form focuses its first field; leaving it gives the focus back to «Засах». Without the right,
 * people only read.
 */
export function DetailCard(props: {
  title: string;
  canEdit: boolean;
  view: ReactNode;
  edit: (close: () => void) => ReactNode;
  /** More buttons beside «Засах» while reading. */
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) {
      body.current
        ?.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
        )
        ?.focus();
    } else if (wasEditing.current) {
      editButton.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  const showActions = !editing && (props.canEdit || props.actions);
  return (
    <Card role="region" aria-labelledby={titleId} className={props.className}>
      <CardHeader>
        <CardTitle id={titleId}>{props.title}</CardTitle>
        {showActions ? (
          <CardAction className="flex flex-wrap justify-end gap-2">
            {props.actions}
            {props.canEdit ? (
              <Button
                ref={editButton}
                variant="secondary"
                size="sm"
                aria-label={t('common.editRecord', { name: props.title })}
                onClick={() => setEditing(true)}
              >
                <Pencil />
                {t('common.edit')}
              </Button>
            ) : null}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent ref={body}>
        {editing ? props.edit(() => setEditing(false)) : props.view}
      </CardContent>
    </Card>
  );
}

export interface Field {
  label: string;
  /** null, undefined or '' shows «—». */
  value: ReactNode;
  /** A smaller line under the value (where it came from, a unit). */
  hint?: ReactNode;
  /** Takes the whole width (notes, addresses). */
  wide?: boolean;
}

/** Label-over-value pairs in two columns: the reading side of a DetailCard. */
export function FieldList(props: { items: readonly Field[]; className?: string }) {
  const { t } = useTranslation();
  return (
    <dl className={cn('grid gap-x-8 gap-y-4 sm:grid-cols-2', props.className)}>
      {props.items.map((item) => (
        <div key={item.label} className={cn('min-w-0', item.wide && 'sm:col-span-2')}>
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-sm break-words">
            {item.value === null || item.value === undefined || item.value === ''
              ? t('common.none')
              : item.value}
          </dd>
          {item.hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
