import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-entity">{t('audit.entity')}</Label>
          <NativeSelect
            id="audit-entity"
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
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-from">{t('audit.from')}</Label>
          <Input
            id="audit-from"
            type="date"
            value={filter.from ?? ''}
            onChange={(event) => setFilter({ ...filter, from: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-to">{t('audit.to')}</Label>
          <Input
            id="audit-to"
            type="date"
            value={filter.to ?? ''}
            onChange={(event) => setFilter({ ...filter, to: event.target.value })}
          />
        </div>
      </div>
      <ProblemAlert problem={problemFromError(audit.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('audit.time')}</TableHead>
            <TableHead>{t('audit.actor')}</TableHead>
            <TableHead>{t('audit.action')}</TableHead>
            <TableHead>{t('audit.entity')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry) => (
            <Fragment key={entry.id}>
              <TableRow>
                <TableCell>{formatUbDateTime(Date.parse(entry.occurredAt))}</TableCell>
                <TableCell>
                  <Actor entry={entry} />
                </TableCell>
                <TableCell>
                  <ActionLabel action={entry.action} />
                </TableCell>
                <TableCell>
                  <EntityLabel entity={entry.entity} />
                  {` #${entry.entityId}`}
                </TableCell>
                <TableCell>
                  {entry.before !== null || entry.after !== null ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpen(open === entry.id ? null : entry.id)}
                    >
                      {t('audit.details')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
              {open === entry.id ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium">{t('audit.before')}</p>
                        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                          {JSON.stringify(entry.before, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs font-medium">{t('audit.after')}</p>
                        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
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
        <p className="py-6 text-sm text-muted-foreground">{t('audit.empty')}</p>
      ) : null}
      {audit.hasNextPage ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
