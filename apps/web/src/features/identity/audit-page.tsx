import { ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  LoadMore,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { cn } from '@/lib/utils';
import { type AuditEntry, type AuditFilter, useAudit } from './api';
import { AUDIT_ENTITIES, isAuditAction, isAuditEntity } from './labels';

/** The log's columns (ADR-0119); the entity wraps (session ids are long), the details fold out. */
const COLUMNS: readonly ColumnSpec[] = [
  // The time keeps its seconds («2026-10-29 19:52:11»).
  { key: 'time', kind: 'datetime', width: 12.5 },
  { key: 'actor', kind: 'text', weight: 1 },
  { key: 'action', kind: 'code', width: 12 },
  { key: 'entity', kind: 'text', weight: 2 },
  { key: 'details', kind: 'actions', actions: 1 },
];

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

/**
 * Who changed what and when, newest first (SPEC §5.1). The filters live in the URL (`?entity=`,
 * `?from=`, `?to=`), so a filtered log can be shared and survives a reload (ADR-0066); a row with
 * a before / after unfolds them under it.
 */
export function AuditPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const filter: AuditFilter = {
    entity: params.get('entity') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
  const filtered = Boolean(filter.entity || filter.from || filter.to);
  const [open, setOpen] = useState<number | null>(null);
  const audit = useAudit(filter);
  const rows = audit.data?.pages.flatMap((page) => page.data) ?? [];

  // One navigation for the three: separate setParam calls would each start from the same address.
  const clearFilters = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of ['entity', 'from', 'to']) next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader title={t('audit.title')} />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('audit.entity')}
          value={filter.entity ?? ''}
          onChange={(event) => setParam('entity', event.target.value)}
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
          onChange={(from) => setParam('from', from)}
        />
        <DateFilter label={t('audit.to')} value={filter.to} onChange={(to) => setParam('to', to)} />
      </FilterBar>
      <ProblemAlert problem={problemFromError(audit.error)} onRetry={audit.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
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
            {rows.map((entry) => {
              const expanded = open === entry.id;
              return (
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
                    <TableCell className="whitespace-normal">
                      <EntityLabel entity={entry.entity} />
                      {/* Session ids are long UUIDs: they wrap (in two lines at most) instead of
                          pushing the details off the card. */}
                      <span className="font-mono break-all text-muted-foreground">{` #${entry.entityId}`}</span>
                    </TableCell>
                    <TableCell className="py-0.5 text-right">
                      {entry.before !== null || entry.after !== null ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          aria-label={t('audit.details')}
                          title={t('audit.details')}
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : entry.id)}
                        >
                          <ChevronRight
                            className={cn('transition-transform', expanded && 'rotate-90')}
                          />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow className="bg-accent/40 hover:bg-accent/40">
                      <TableCell colSpan={5} className="whitespace-normal">
                        <div className="grid gap-3 pt-1 pb-2 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              {t('audit.before')}
                            </p>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-background p-2.5 text-xs whitespace-pre-wrap ring-1 ring-border wrap-anywhere">
                              {JSON.stringify(entry.before, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              {t('audit.after')}
                            </p>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-background p-2.5 text-xs whitespace-pre-wrap ring-1 ring-border wrap-anywhere">
                              {JSON.stringify(entry.after, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </ListTable>
        {!audit.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t('audit.empty')}
            onClearFilters={filtered ? clearFilters : undefined}
          />
        ) : null}
        <LoadMore query={audit} />
      </ListCard>
    </div>
  );
}
