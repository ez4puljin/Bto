import { failureReasonOf } from '@tugeel/shared/ai';
import { ChevronRight, Download, FileChartColumn, Sparkles, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AiQuestion, AiResult } from './api';
import { ResultTable } from './result-table';

const STATUS_BADGE = {
  ANSWERED: 'success',
  CLARIFY: 'secondary',
  UNSUPPORTED: 'warning',
  REFUSED: 'destructive',
  FAILED: 'destructive',
} as const satisfies Record<AiQuestion['status'], string>;

/** The SQL behind an answer, folded (ADR-0045: shown so people can check the numbers). */
export function HowComputed({ sql, repaired }: { sql: string; repaired?: boolean }) {
  const { t } = useTranslation();
  return (
    <details className="group rounded-xl border border-border/90 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[13px] text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
        {t('ai.answer.howComputed')}
      </summary>
      <div className="space-y-2 border-t border-border/80 px-3.5 py-2.5">
        {repaired ? (
          <p className="text-xs text-muted-foreground">{t('ai.answer.repaired')}</p>
        ) : null}
        <pre className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {sql}
        </pre>
      </div>
    </details>
  );
}

/**
 * One step of a conversation: the question, then the assistant's answer. An answer shows its
 * summary as plain text (never markdown), the table when its rows are here (fetched again on
 * demand for older steps), the Excel and «Тайлан болгох» actions and the folded SQL. A question
 * that ended without rows shows the model's note or why it failed.
 */
export function AnswerStep(props: {
  question: AiQuestion;
  result: AiResult | undefined;
  loadingRows: boolean;
  downloading: boolean;
  onShowRows: () => void;
  onDownload: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const { question } = props;
  const answered = question.status === 'ANSWERED';
  const reason = failureReasonOf(question.status, question.errorCode);

  return (
    <li className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-info-soft px-4 py-2.5 text-sm whitespace-pre-wrap">
        <span className="sr-only">{`${t('ai.answer.you')}: `}</span>
        {question.question}
      </p>
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Sparkles aria-hidden className="size-3.5" />
            <span>{t('ai.answer.assistant')}</span>
            {answered ? null : (
              <Badge variant={STATUS_BADGE[question.status]}>
                {t(`ai.statuses.${question.status}`)}
              </Badge>
            )}
          </div>
          {question.summary ? (
            <p className="text-sm whitespace-pre-wrap">{question.summary}</p>
          ) : null}
          {question.explanation ? (
            <p
              className={answered ? 'text-sm text-muted-foreground' : 'text-sm whitespace-pre-wrap'}
            >
              {question.explanation}
            </p>
          ) : null}
          {reason ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`ai.reasons.${reason}`)}</AlertDescription>
            </Alert>
          ) : null}
          {answered && props.result ? (
            <ResultTable result={props.result} label={question.question} />
          ) : null}
          {answered ? (
            <div className="flex flex-wrap gap-2">
              {props.result ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={props.loadingRows}
                  onClick={props.onShowRows}
                >
                  <Table2 />
                  {t('ai.answer.showTable')}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={props.downloading}
                onClick={props.onDownload}
              >
                <Download />
                {t('ai.answer.download')}
              </Button>
              <Button variant="outline" size="sm" onClick={props.onSave}>
                <FileChartColumn />
                {t('ai.answer.saveAsReport')}
              </Button>
            </div>
          ) : null}
          {question.sql ? <HowComputed sql={question.sql} repaired={question.repaired} /> : null}
        </CardContent>
      </Card>
    </li>
  );
}
