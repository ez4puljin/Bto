import { ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { type AuditEntry, type AuditFilter, useAudit } from './api';
import { AUDIT_ENTITIES, isAuditAction, isAuditEntity } from './labels';

function ActionLabel({ action }: { action: string }) {
  const { t } = useTranslation();
  return <>{isAuditAction(action) ? t(`audit.actions.${action}`) : action}</>;
}

function EntityLabel({ entity }: { entity: string }) {
  const { t } = useTranslation();
  return <>{isAuditEntity(entity) ? t(`audit.entities.${entity}`) : entity}</>;
}

function Actor({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  if (entry.actorKind === 'SYSTEM')
    return <>{t('audit.system', { label: entry.actorLabel ?? '' })}</>;
  return <>{entry.actorUsername ?? String(entry.actorId ?? '')}</>;
}

/** Who changed what and when, newest first (SPEC §5.1). */
export function AuditPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AuditFilter>({});
  const [open, setOpen] = useState<number | null>(null);
  const audit = useAudit(filter);
  const rows = audit.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader title={t('audit.title')} />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('audit.entity')}
          value={filter.entity ?? ''}
          onChange={(event) => setFilter({ ...filter, entity: event.target.value })}
        >
          <option value="">{t('audit.allEntities')}</option>
          {AUDIT_ENTITIES.map((entity) => (
            <option key={entity} value={entity}>
              {t(`audit.entities.${entity}`)}
            </option>
          ))}
        </NativeSelect>
        <DateFilter
          label={t('audit.from')}
          value={filter.from}
          onChange={(from) => setFilter({ ...filter, from })}
        />
        <DateFilter
          label={t('audit.to')}
          value={filter.to}
          onChange={(to) => setFilter({ ...filter, to })}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(audit.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('audit.time')}</TableHead>
              <TableHead>{t('audit.actor')}</TableHead>
              <TableHead>{t('audit.action')}</TableHead>
              <TableHead>{t('audit.entity')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('audit.details')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.isPending ? <SkeletonRows columns={5} /> : null}
            {rows.map((entry) => (
              <Fragment key={entry.id}>
                <TableRow>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(entry.occurredAt))}
                  </TableCell>
                  <TableCell>
                    <Actor entry={entry} />
                  </TableCell>
                  <TableCell>
                    <ActionLabel action={entry.action} />
                  </TableCell>
                  <TableCell className="min-w-64 whitespace-normal">
                    <EntityLabel entity={entry.entity} />
                    {/* Session ids are long UUIDs: they wrap (in two lines at most) instead of
                        pushing the details off the card. */}
                    <span className="font-mono break-all text-muted-foreground">{` #${entry.entityId}`}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.before !== null || entry.after !== null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-link"
                        aria-expanded={open === entry.id}
                        onClick={() => setOpen(open === entry.id ? null : entry.id)}
                      >
                        {t('audit.details')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
                {open === entry.id ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="whitespace-normal">
                      <div className="grid gap-3 pb-1 md:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {t('audit.before')}
                          </p>
                          <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2.5 text-xs whitespace-pre-wrap wrap-anywhere">
                            {JSON.stringify(entry.before, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {t('audit.after')}
                          </p>
                          <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2.5 text-xs whitespace-pre-wrap wrap-anywhere">
                            {JSON.stringify(entry.after, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        {!audit.isPending && rows.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('audit.empty')} />
        ) : null}
        <LoadMore query={audit} />
      </ListCard>
    </div>
  );
}
