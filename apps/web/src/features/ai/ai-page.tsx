import { AI_QUESTION_MAX_LENGTH } from '@tugeel/shared/ai';
import mn from '@tugeel/shared/i18n/mn.json';
import { Database, Loader2, MessageSquarePlus, SendHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ListCard, LoadMore } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { formatUbDateTime } from '@/lib/dayjs';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type AiQuestion,
  type AiResult,
  useAiMutations,
  useAiStatus,
  useConversation,
  useConversations,
} from './api';
import { AnswerStep } from './answer-step';
import { ReportNameDialog } from './report-name-dialog';

const EXAMPLE_KEYS = Object.keys(mn.ai.examples) as (keyof typeof mn.ai.examples)[];
const DATASET_KEYS = Object.keys(mn.ai.datasets) as (keyof typeof mn.ai.datasets)[];

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/**
 * «AI туслах» (ADR-0045): the user's conversations on the side, the open one in the middle (64rem
 * at most), the question box floating at its foot (ADR-0066). The open conversation lives in the
 * URL (`?c=`) and shows its outline while it loads. Rows of a fresh answer come with it; older
 * steps fetch theirs again on demand, since rows are never stored.
 */
export function AiPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const conversationId = positiveId(params.get('c'));
  const status = useAiStatus();
  const conversations = useConversations();
  const conversation = useConversation(conversationId);
  const mutations = useAiMutations();
  const asking = useAction();
  const rows = useAction();
  const [draft, setDraft] = useState('');
  const [key, setKey] = useState(randomUuid);
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Readonly<Record<number, AiResult>>>({});
  const [loadingRows, setLoadingRows] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  /** The answer being saved as a report, with the key of that one intent. */
  const [saving, setSaving] = useState<{ question: AiQuestion; key: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLFormElement>(null);

  const configured = status.data?.configured === true;
  const list = useMemo(
    () => conversations.data?.pages.flatMap((page) => page.data) ?? [],
    [conversations.data],
  );
  const steps = conversationId === undefined ? [] : (conversation.data?.questions ?? []);
  const loadingConversation = conversationId !== undefined && conversation.isPending;
  const stillWorking = asking.problem?.code === 'IDEMPOTENCY_KEY_IN_PROGRESS';
  // The question box floats at the foot of the window only over answers it adds to; on an empty
  // page (examples, datasets) or while the assistant is off it stays in the flow (ADR-0066).
  const floating = configured && (steps.length > 0 || pending !== null);

  // Follows the conversation as it grows; an empty page stays at its top (the notice, examples).
  useEffect(() => {
    if (steps.length > 0 || pending) end.current?.scrollIntoView?.({ block: 'end' });
  }, [steps.length, pending]);

  // Toasts («Тайлан хадгалагдлаа») rise above the floating question box, as above StickyActions.
  useEffect(() => {
    const element = composer.current;
    if (!floating || !element) return;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty('--sticky-actions-space', `${element.offsetHeight + 12}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--sticky-actions-space');
    };
  }, [floating]);

  const startNew = () => {
    setParams({});
    setDraft('');
    setKey(randomUuid());
    asking.clear();
    box.current?.focus();
  };

  const submit = async () => {
    const question = draft.trim();
    if (!question || !configured || pending) return;
    setPending(question);
    await asking.run(async () => {
      const answer = await mutations.ask.mutateAsync({ key, question, conversationId });
      const result = answer.result;
      if (result) setResults((current) => ({ ...current, [answer.question.id]: result }));
      setDraft('');
      setKey(randomUuid());
      if (answer.conversationId !== conversationId) {
        setParams({ c: String(answer.conversationId) });
      }
    });
    setPending(null);
  };

  const showRows = (question: AiQuestion) => {
    setLoadingRows(question.id);
    void rows
      .run(async () => {
        const result = await mutations.runQuestion.mutateAsync(question.id);
        setResults((current) => ({ ...current, [question.id]: result }));
      })
      .finally(() => setLoadingRows(null));
  };

  const download = (question: AiQuestion) => {
    setDownloading(question.id);
    void rows
      .run(async () => {
        saveBlob(await mutations.exportQuestion.mutateAsync(question.id), `AI ${question.id}.xlsx`);
      })
      .finally(() => setDownloading(null));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('ai.title')}
        meta={status.data?.model ? <Badge variant="secondary">{status.data.model}</Badge> : null}
        actions={
          <Button variant="outline" onClick={startNew}>
            <MessageSquarePlus />
            {t('ai.newConversation')}
          </Button>
        }
      />
      {status.data && !configured ? (
        <Alert>
          <AlertTitle>{t('ai.notConfigured.title')}</AlertTitle>
          <AlertDescription>{t('ai.notConfigured.body')}</AlertDescription>
        </Alert>
      ) : null}
      {/* The conversation stops at 64rem: answers stay readable on a wide screen (ADR-0066). */}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,64rem)]">
        <section aria-label={t('ai.conversations')} className="order-2 lg:order-1">
          <ListCard>
            <h2 className="border-b px-4 py-2.5 text-sm font-medium">{t('ai.conversations')}</h2>
            {list.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t('ai.noConversations')}</p>
            ) : (
              <ul className="divide-y">
                {list.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={`/ai?c=${item.id}`}
                      aria-current={item.id === conversationId ? 'page' : undefined}
                      className={cn(
                        'block px-4 py-2.5 text-sm hover:bg-accent',
                        item.id === conversationId && 'bg-accent font-medium',
                      )}
                    >
                      <span className="line-clamp-2">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatUbDateTime(Date.parse(item.updatedAt))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <LoadMore query={conversations} />
          </ListCard>
        </section>

        <section aria-label={t('ai.title')} className="order-1 min-w-0 space-y-4 lg:order-2">
          <ProblemAlert
            problem={problemFromError(conversation.error)}
            onRetry={conversation.refetch}
          />
          {loadingConversation ? (
            // An opened conversation loads: its outline, never the empty page's examples.
            <div role="status" className="space-y-4">
              <span className="sr-only">{t('common.loading')}</span>
              <div
                aria-hidden
                className="ml-auto h-10 w-2/5 animate-pulse rounded-2xl bg-info-soft"
              />
              <div
                aria-hidden
                className="h-36 animate-pulse rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]"
              />
            </div>
          ) : steps.length === 0 && !pending ? (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Sparkles aria-hidden className="mt-0.5 size-5 text-link" />
                  <div className="space-y-1">
                    <h2 className="font-medium">{t('ai.emptyTitle')}</h2>
                    <p className="text-sm text-muted-foreground">{t('ai.emptyHint')}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase">
                    {t('ai.examplesTitle')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLE_KEYS.map((example) => (
                      <Button
                        key={example}
                        variant="secondary"
                        size="sm"
                        className="h-auto py-1.5 text-left whitespace-normal"
                        onClick={() => {
                          setDraft(t(`ai.examples.${example}`));
                          box.current?.focus();
                        }}
                      >
                        {t(`ai.examples.${example}`)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase">
                    {t('ai.datasetsTitle')}
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {DATASET_KEYS.map((dataset) => (
                      <li key={dataset}>
                        <Badge variant="outline">
                          <Database aria-hidden />
                          {t(`ai.datasets.${dataset}`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ) : (
            <ol
              aria-label={conversation.data?.conversation.title ?? t('ai.title')}
              className="space-y-6"
            >
              {steps.map((step) => (
                <AnswerStep
                  key={step.id}
                  question={step}
                  result={results[step.id]}
                  loadingRows={loadingRows === step.id}
                  downloading={downloading === step.id}
                  onShowRows={() => showRows(step)}
                  onDownload={() => download(step)}
                  onSave={() => setSaving({ question: step, key: randomUuid() })}
                />
              ))}
              {pending ? (
                <li className="space-y-3">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-info-soft px-4 py-2.5 text-sm whitespace-pre-wrap">
                    {pending}
                  </p>
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                    {t('ai.thinking')}
                  </p>
                </li>
              ) : null}
            </ol>
          )}
          <ProblemAlert problem={rows.problem} />
          {/* Over a conversation the question box floats at the foot of the window while the
              answers scroll under it; its own refusals show inside it, next to the question. */}
          <form
            ref={composer}
            data-floating={floating ? 'true' : undefined}
            className={cn(
              'space-y-2 rounded-2xl p-3 ring-1 ring-black/[0.06] print:hidden',
              floating
                ? 'sticky bottom-3 z-20 bg-background/95 shadow-popover backdrop-blur-md'
                : 'bg-card shadow-card',
            )}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {stillWorking ? (
              <Alert>
                <AlertDescription>{t('ai.stillWorking')}</AlertDescription>
              </Alert>
            ) : (
              <ProblemAlert problem={asking.problem} />
            )}
            <Textarea
              ref={box}
              aria-label={t('ai.placeholder')}
              placeholder={t('ai.placeholder')}
              className="max-h-48"
              value={draft}
              maxLength={AI_QUESTION_MAX_LENGTH}
              rows={3}
              disabled={!configured}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-xs text-muted-foreground">{t('ai.privacyNote')}</p>
              <Button
                type="submit"
                className="shrink-0"
                disabled={!configured || !draft.trim() || pending !== null}
              >
                {pending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
                {pending ? t('ai.thinking') : t('ai.ask')}
              </Button>
            </div>
          </form>
          <div ref={end} />
        </section>
      </div>

      {saving ? (
        <ReportNameDialog
          open
          title={t('ai.report.saveTitle')}
          description={t('ai.report.saveHint')}
          initialName={saving.question.question.slice(0, 120)}
          submitLabel={t('ai.report.save')}
          onSubmit={async (name) => {
            await mutations.saveReport.mutateAsync({
              key: saving.key,
              questionId: saving.question.id,
              name,
            });
            toast.success(t('ai.report.saved'));
          }}
          onClose={() => setSaving(null)}
        />
      ) : null}
    </div>
  );
}
