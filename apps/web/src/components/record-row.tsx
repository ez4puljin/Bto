import { Eye, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';

const STICKY = 'sticky left-0 z-10 bg-background';

/** The header cell above the rows' «Засах» buttons. */
export function RecordActionsHead() {
  const { t } = useTranslation();
  return (
    <TableHead className={STICKY}>
      <span className="sr-only">{t('common.actions')}</span>
    </TableHead>
  );
}

/**
 * A list row that opens its record (ADR-0037): a sticky «Засах» button (or «Харах» without the
 * right to edit) and a click anywhere on the row. Links and buttons inside the row act on their own.
 */
export function RecordRow(props: {
  href: string;
  name: string;
  canManage: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('a, button')) return;
        void navigate(props.href);
      }}
    >
      <TableCell className={STICKY}>
        <Button asChild size="sm" variant="outline">
          <Link
            to={props.href}
            aria-label={
              props.canManage
                ? t('common.editRecord', { name: props.name })
                : t('common.viewRecord', { name: props.name })
            }
          >
            {props.canManage ? <Pencil /> : <Eye />}
            {props.canManage ? t('common.edit') : t('common.view')}
          </Link>
        </Button>
      </TableCell>
      {props.children}
    </TableRow>
  );
}
