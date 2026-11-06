import {
  CATEGORY_ICON_KEYS,
  type CategoryIconKey,
  categoryIconOf,
  categoryIconSvg,
} from '@tugeel/shared/category-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const sources = new Map<CategoryIconKey, string>();

/** A drawing as an image's address, built once. */
function sourceOf(key: CategoryIconKey): string {
  const known = sources.get(key);
  if (known) return known;
  const source = `data:image/svg+xml,${encodeURIComponent(categoryIconSvg(key))}`;
  sources.set(key, source);
  return source;
}

/** A category's drawing (ADR-0163): the one chosen for it, else what its name asks for. */
export function CategoryIcon(props: {
  category: { iconKey: string | null; name: string };
  className?: string;
}) {
  return (
    <img
      alt=""
      aria-hidden
      src={sourceOf(categoryIconOf(props.category))}
      className={cn('size-7 shrink-0', props.className)}
    />
  );
}

/**
 * «Дүрс» in the category's dialog: by default the drawing follows the name as it is typed; «Солих»
 * opens every drawing to choose one, «Автомат» goes back to following the name.
 */
export function CategoryIconField(props: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const shown = categoryIconOf({ iconKey: props.value || null, name: props.name });
  return (
    <div id={props.id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <CategoryIcon category={{ iconKey: shown, name: props.name }} className="size-11" />
        <span className="min-w-0 flex-1 text-sm">
          {t(`catalog.categories.icons.${shown}`)}
          <span className="block text-xs text-muted-foreground">
            {t(props.value ? 'catalog.categories.iconChosen' : 'catalog.categories.iconAuto')}
          </span>
        </span>
        {props.value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onChange('')}>
            {t('catalog.categories.iconUseAuto')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {t('catalog.categories.iconChange')}
        </Button>
      </div>
      {open ? (
        <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1 overflow-y-auto rounded-lg border p-1.5">
          {CATEGORY_ICON_KEYS.map((key) => {
            const label = t(`catalog.categories.icons.${key}`);
            return (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={shown === key}
                title={label}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-md p-0.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                  shown === key && 'bg-secondary ring-2 ring-primary',
                )}
                onClick={() => {
                  props.onChange(key);
                  setOpen(false);
                }}
              >
                <img alt="" aria-hidden src={sourceOf(key)} className="size-full" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
