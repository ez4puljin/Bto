import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * «Баганууд»: shows or hides each column of a list; locked columns always show (ADR-0037). The
 * caller keeps the choice with `useHiddenColumns`.
 */
export function ColumnChooser<K extends string>(props: {
  keys: readonly K[];
  locked: readonly K[];
  label: (key: K) => string;
  hidden: ReadonlySet<string>;
  toggle: (key: K) => void;
  showAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 />
          {t('common.columns')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {props.keys.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={!props.hidden.has(key)}
            disabled={props.locked.includes(key)}
            onCheckedChange={() => props.toggle(key)}
            // Keep the menu open while several columns are picked.
            onSelect={(event) => event.preventDefault()}
          >
            {props.label(key)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={props.hidden.size === 0} onSelect={props.showAll}>
          {t('common.showAllColumns')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
