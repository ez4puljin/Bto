import { Download, FileChartColumn, Loader2, Pencil, Play, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  EmptyState,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  RowActionSpacer,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordSheet } from '@/components/record-sheet';
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
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { HowComputed } from './answer-step';
import { type AiReport, type AiResult, useAiMutations, useReports } from './api';
import { ReportNameDialog } from './report-name-dialog';
import { ResultTable } from './result-table';

/**
 * «Тайлангууд» (ADR-0045 #8): reports saved from answers. Every holder of `ai.ask` runs one or
 * downloads it as Excel, without the model; its author (or `ai.reports.manage`) renames or deletes
 * it. Dates in a report follow today (current_date), so a report stays current. A run opens its
 * rows in a side panel at once, with «Excel татах» in the panel's header (ADR-0066).
 */
export function AiReportsPage() {
  const { t } = useTranslation();
  const reports = useReports();
  const mutations = useAiMutations();
  const action = useAction();
  const running = useAction();
  const rows = useMemo(
    () => reports.data?.pages.flatMap((page) => page.data) ?? [],
    [reports.data],
  );
  /** The report in the panel; kept while the panel slides out, so it never empties first. */
  const [shown, setShown] = useState<AiReport | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  /** The rows of the report in the panel; a late answer for another report is ignored. */
  const [result, setResult] = useState<{ id: number; result: AiResult } | null>(null);
  const [renaming, setRenaming] = useState<AiReport | null>(null);
  const [deleting, setDeleting] = useState<AiReport | null>(null);
  const shownResult = shown && result?.id === shown.id ? result.result : null;

  const run = (report: AiReport) => {
    setShown(report);
    setPanelOpen(true);
    setResult(null);
    void running.run(async () => {
      const next = await mutations.runReport.mutateAsync(report.id);
      setResult({ id: report.id, result: next });
    });
  };

  const download = (report: AiReport) =>
    void action.run(async () => {
      saveBlob(await mutations.exportReport.mutateAsync(report.id), `${report.name}.xlsx`);
    });

  const closeDelete = () => {
    mutations.deleteReport.reset();
    setDeleting(null);
  };

  return (
    <div>
      <PageHeader title={t('ai.reportsTitle')} />
      <ProblemAlert
        problem={panelOpen ? null : (action.problem ?? problemFromError(reports.error))}
      />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('ai.report.nameLabel')}</TableHead>
              <TableHead>{t('ai.report.createdBy')}</TableHead>
              <TableHead>{t('ai.report.updatedAt')}</TableHead>
              <TableHead className="w-px">
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.isPending ? <SkeletonRows columns={4} /> : null}
            {rows.map((report) => (
              <TableRow key={report.id}>
                <TruncateCell fill text={report.name} className="font-medium" />
                <TableCell>{report.createdBy.fullName}</TableCell>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(report.updatedAt))}
                </TableCell>
                <RowActions>
                  <RowAction
                    icon={Play}
                    label={`${t('ai.report.run')}: ${report.name}`}
                    onClick={() => run(report)}
                  />
                  <RowAction
                    icon={Download}
                    label={`${t('ai.answer.download')}: ${report.name}`}
                    onClick={() => download(report)}
                  />
                  {report.canChange ? (
                    <>
                      <RowAction
                        icon={Pencil}
                        label={`${t('ai.report.rename')}: ${report.name}`}
                        onClick={() => setRenaming(report)}
                      />
                      <RowAction
                        icon={Trash2}
                        label={`${t('ai.report.delete')}: ${report.name}`}
                        destructive
                        onClick={() => setDeleting(report)}
                      />
                    </>
                  ) : (
                    <>
                      <RowActionSpacer />
                      <RowActionSpacer />
                    </>
                  )}
                </RowActions>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && !reports.isPending ? (
          <EmptyState
            icon={FileChartColumn}
            title={t('ai.report.empty')}
            action={
              <Button asChild variant="outline">
                <Link to="/ai">{t('nav.aiAssistant')}</Link>
              </Button>
            }
          />
        ) : null}
        <LoadMore query={reports} />
      </ListCard>

      <RecordSheet
        open={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          action.clear();
        }}
        title={shown?.name ?? ''}
        description={
          shown
            ? `${shown.createdBy.fullName} · ${formatUbDateTime(Date.parse(shown.updatedAt))}`
            : ''
        }
        actions={
          shown ? (
            <Button variant="outline" size="sm" onClick={() => download(shown)}>
              <Download />
              {t('ai.answer.download')}
            </Button>
          ) : null
        }
      >
        {shown ? (
          <div className="space-y-4">
            <ProblemAlert problem={running.problem ?? action.problem} />
            {shownResult ? (
              <ResultTable tall result={shownResult} label={shown.name} />
            ) : running.problem ? null : (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {t('common.loading')}
              </p>
            )}
            <HowComputed sql={shown.sql} />
          </div>
        ) : null}
      </RecordSheet>

      {renaming ? (
        <ReportNameDialog
          open
          title={t('ai.report.rename')}
          initialName={renaming.name}
          submitLabel={t('common.save')}
          onSubmit={async (name) => {
            await mutations.renameReport.mutateAsync({ id: renaming.id, name });
            toast.success(t('ai.report.renamed'));
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={t('ai.report.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmLabel={t('ai.report.delete')}
        pending={mutations.deleteReport.isPending}
        problem={problemFromError(mutations.deleteReport.error)}
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          mutations.deleteReport.mutate(target.id, {
            onSuccess: () => {
              if (shown?.id === target.id) setPanelOpen(false);
              closeDelete();
              toast.success(t('ai.report.deleted'));
            },
          });
        }}
        onClose={closeDelete}
      />
    </div>
  );
}
