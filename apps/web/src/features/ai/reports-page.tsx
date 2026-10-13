import { Download, FileChartColumn, Pencil, Play, Trash2, X } from 'lucide-react';
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
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { HowComputed } from './answer-step';
import { type AiReport, type AiResult, saveBlob, useAiMutations, useReports } from './api';
import { ReportNameDialog } from './report-name-dialog';
import { ResultTable } from './result-table';

/**
 * «Тайлангууд» (ADR-0045 #8): reports saved from answers. Every holder of `ai.ask` runs one or
 * downloads it as Excel, without the model; its author (or `ai.reports.manage`) renames or deletes
 * it. Dates in a report follow today (current_date), so a report stays current.
 */
export function AiReportsPage() {
  const { t } = useTranslation();
  const reports = useReports();
  const mutations = useAiMutations();
  const action = useAction();
  const rows = useMemo(
    () => reports.data?.pages.flatMap((page) => page.data) ?? [],
    [reports.data],
  );
  const [shown, setShown] = useState<{ report: AiReport; result: AiResult } | null>(null);
  const [renaming, setRenaming] = useState<AiReport | null>(null);
  const [deleting, setDeleting] = useState<AiReport | null>(null);

  const run = (report: AiReport) =>
    void action.run(async () => {
      setShown({ report, result: await mutations.runReport.mutateAsync(report.id) });
    });

  const download = (report: AiReport) =>
    void action.run(async () => {
      saveBlob(await mutations.exportReport.mutateAsync(report.id), `${report.name}.xlsx`);
    });

  const closeDelete = () => {
    mutations.deleteReport.reset();
    setDeleting(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('ai.reportsTitle')} />
      <ProblemAlert problem={action.problem ?? problemFromError(reports.error)} />
      <ListCard>
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
            {rows.map((report) => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">{report.name}</TableCell>
                <TableCell>{report.createdBy.fullName}</TableCell>
                <TableCell className="whitespace-nowrap">
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

      {shown ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{shown.report.name}</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => setShown(null)}
            >
              <X />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <ResultTable result={shown.result} label={shown.report.name} />
            <HowComputed sql={shown.report.sql} />
          </CardContent>
        </Card>
      ) : null}

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
              if (shown?.report.id === target.id) setShown(null);
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
