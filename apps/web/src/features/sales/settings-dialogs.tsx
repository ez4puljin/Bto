import {
  ORDER_CHANNELS,
  ORDER_NUMBER_LIMITS,
  ORDER_NUMBER_TOKENS,
  orderNumberPatternIssues,
  renderOrderNumber,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranches } from '@/features/identity/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ChannelDefault,
  type Numbering,
  type SalesBoard,
  useChannels,
  usePipeline,
  useSalesMutations,
} from './pipelines-api';

/** A board: its name and, if any, the branch it is for (ADR-0057 #1). */
export function BoardDialog({ board, onClose }: { board: SalesBoard | null; onClose: () => void }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const mutations = useSalesMutations();
  const action = useAction();
  const [name, setName] = useState(board?.name ?? '');
  const [branchId, setBranchId] = useState(board?.branchId ? String(board.branchId) : '');
  const save = () =>
    void action.run(async () => {
      const body = { name: name.trim(), branchId: branchId ? Number.parseInt(branchId, 10) : null };
      if (board) await mutations.updateBoard.mutateAsync({ id: board.id, ...body });
      else await mutations.createBoard.mutateAsync(body);
      toast.success(t('sales.boards.saved'));
      onClose();
    });
  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>
          {board ? t('sales.pipelines.editBoard') : t('sales.pipelines.newBoard')}
        </DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <FormField label={t('sales.boards.name')} htmlFor="board-name">
          <Input
            id="board-name"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={t('sales.boards.branch')} htmlFor="board-branch">
          <NativeSelect
            id="board-branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">{t('sales.boards.noBranch')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <ProblemAlert problem={action.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button
            type="submit"
            disabled={
              !name.trim() || mutations.createBoard.isPending || mutations.updateBoard.isPending
            }
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** «Хуулбарлах»: a copy of a pipeline under a new name, in a board of choice. */
export function CopyDialog({
  source,
  boards,
  onClose,
}: {
  source: { id: number; name: string; boardId: number };
  boards: readonly SalesBoard[];
  onClose: (copiedId?: number) => void;
}) {
  const { t } = useTranslation();
  const mutations = useSalesMutations();
  const action = useAction();
  const [name, setName] = useState(t('sales.pipelines.copyName', { name: source.name }));
  const [boardId, setBoardId] = useState(source.boardId);
  const copy = () =>
    void action.run(async () => {
      const copied = await mutations.copyPipeline.mutateAsync({
        id: source.id,
        name: name.trim(),
        boardId,
      });
      toast.success(t('sales.pipelines.copied'));
      onClose(copied.id);
    });
  return (
    <DialogContent closeLabel={t('common.close')}>
      <DialogHeader>
        <DialogTitle>{t('sales.pipelines.copyTitle', { name: source.name })}</DialogTitle>
        <DialogDescription>{t('sales.pipelines.copyDescription')}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          copy();
        }}
      >
        <FormField label={t('sales.boards.name')} htmlFor="copy-name">
          <Input
            id="copy-name"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label={t('sales.pipelines.board')} htmlFor="copy-board">
          <NativeSelect
            id="copy-board"
            value={boardId}
            onChange={(event) => setBoardId(Number.parseInt(event.target.value, 10))}
          >
            {boards
              .filter((board) => board.archivedAt === null)
              .map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
          </NativeSelect>
        </FormField>
        <ProblemAlert problem={action.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button type="submit" disabled={!name.trim() || mutations.copyPipeline.isPending}>
            {t('sales.pipelines.copy')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * «Дугаарлалт» (ADR-0057 #3): the company's order number format with its tokens and digits, an
 * example of the number it gives today, and the shared rules' refusals before anything is sent.
 */
export function NumberingDialog({
  numbering,
  onClose,
}: {
  numbering: Numbering;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useSalesMutations();
  const action = useAction();
  const [pattern, setPattern] = useState(numbering.pattern);
  const [digits, setDigits] = useState(String(numbering.digits));
  const count = Number.parseInt(digits, 10);
  const issues = orderNumberPatternIssues(pattern.trim(), Number.isNaN(count) ? 0 : count);
  const patternIssue = issues.find((issue) => issue.path === 'pattern');
  const digitsIssue = issues.find((issue) => issue.path === 'digits');
  const save = () =>
    void action.run(async () => {
      await mutations.setNumbering.mutateAsync({ pattern: pattern.trim(), digits: count });
      toast.success(t('sales.numbering.saved'));
      onClose();
    });
  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <DialogHeader>
        <DialogTitle>{t('sales.numbering.title')}</DialogTitle>
        <DialogDescription>{t('sales.numbering.description')}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (issues.length === 0) save();
        }}
      >
        <FormField
          label={t('sales.numbering.pattern')}
          htmlFor="numbering-pattern"
          hint={
            patternIssue ? (
              <span role="alert" className="text-sm text-destructive">
                {t(`sales.numbering.issues.${patternIssue.code}`)}
              </span>
            ) : undefined
          }
        >
          <Input
            id="numbering-pattern"
            autoFocus
            className="font-mono"
            aria-invalid={patternIssue ? true : undefined}
            value={pattern}
            maxLength={ORDER_NUMBER_LIMITS.maxPattern}
            onChange={(event) => setPattern(event.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          {ORDER_NUMBER_TOKENS.map((token) => (
            <Button
              key={token}
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('sales.numbering.insertToken', {
                token: t(`sales.numbering.tokens.${token}`),
              })}
              onClick={() => setPattern((current) => `${current}{${token}}`)}
            >
              {t(`sales.numbering.tokens.${token}`)}
            </Button>
          ))}
        </div>
        <FormField
          label={t('sales.numbering.digits')}
          htmlFor="numbering-digits"
          hint={
            digitsIssue ? (
              <span role="alert" className="text-sm text-destructive">
                {t(`sales.numbering.issues.${digitsIssue.code}`)}
              </span>
            ) : undefined
          }
        >
          <Input
            id="numbering-digits"
            type="number"
            min={ORDER_NUMBER_LIMITS.minDigits}
            max={ORDER_NUMBER_LIMITS.maxDigits}
            className="w-24 font-mono"
            value={digits}
            onChange={(event) => setDigits(event.target.value)}
          />
        </FormField>
        {issues.length === 0 ? (
          <p className="text-sm">
            {t('sales.numbering.example', {
              number: renderOrderNumber(pattern.trim(), count, businessDate(), 1),
            })}
          </p>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button type="submit" disabled={issues.length > 0 || mutations.setNumbering.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

const CHANNELS = ORDER_CHANNELS.filter((channel) => channel !== 'POS');

/**
 * «Сувгийн тохиргоо»: where each channel's new orders land — a pipeline and one of its stages. The
 * customer app's orders wait for the office (ADR-0079 #5): only stages without an action, in
 * pipelines that show every order, are offered for it (the API refuses the others).
 */
export function ChannelsDialog({ boards }: { boards: readonly SalesBoard[] }) {
  const { t } = useTranslation();
  const channels = useChannels();
  return (
    <DialogContent closeLabel={t('common.close')} size="lg">
      <DialogHeader>
        <DialogTitle>{t('sales.channelsDialog.title')}</DialogTitle>
        <DialogDescription>{t('sales.channelsDialog.description')}</DialogDescription>
      </DialogHeader>
      <ProblemAlert problem={problemFromError(channels.error)} />
      <div className="flex flex-col gap-3">
        {CHANNELS.map((channel) => (
          <ChannelRow
            key={channel}
            channel={channel}
            current={channels.data?.find((entry) => entry.channel === channel)}
            boards={boards}
          />
        ))}
      </div>
      <DialogFooter closeLabel={t('common.close')} />
    </DialogContent>
  );
}

function ChannelRow({
  channel,
  current,
  boards,
}: {
  channel: ChannelDefault['channel'];
  current: ChannelDefault | undefined;
  boards: readonly SalesBoard[];
}) {
  const { t } = useTranslation();
  const mutations = useSalesMutations();
  const action = useAction();
  // A pipeline chosen here but not saved until one of its stages is chosen.
  const [chosen, setChosen] = useState<number | null>(null);
  const pipelineId = chosen ?? current?.pipelineId ?? null;
  const pipeline = usePipeline(pipelineId);
  const set = (target: { pipelineId: number; stageId: number } | null) =>
    void action.run(async () => {
      await mutations.setChannel.mutateAsync({
        channel,
        pipelineId: target?.pipelineId ?? null,
        stageId: target?.stageId ?? null,
      });
      setChosen(null);
      toast.success(t('sales.boards.saved'));
    });
  const label = t(`sales.channels.${channel}`);
  const customerApp = channel === 'CUSTOMER_APP';
  const stageValue =
    chosen === null || chosen === current?.pipelineId ? (current?.stageId ?? '') : '';
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr]">
      <Label className="self-center">{label}</Label>
      <NativeSelect
        aria-label={`${t('sales.channelsDialog.pipeline')}: ${label}`}
        value={pipelineId ?? ''}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10) || null;
          if (next === null) set(null);
          else setChosen(next);
        }}
      >
        <option value="">{t('sales.channelsDialog.none')}</option>
        {boards.map((board) => (
          <optgroup key={board.id} label={board.name}>
            {board.pipelines
              .filter((entry) => entry.archivedAt === null && !(customerApp && entry.ownOrdersOnly))
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </optgroup>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label={`${t('sales.channelsDialog.stage')}: ${label}`}
        value={stageValue}
        disabled={pipelineId === null}
        onChange={(event) => {
          const stageId = Number.parseInt(event.target.value, 10) || null;
          if (pipelineId !== null && stageId !== null) set({ pipelineId, stageId });
        }}
      >
        <option value="">{t('sales.channelsDialog.chooseStage')}</option>
        {(pipeline.data?.stages ?? [])
          .filter((stage) => stage.archivedAt === null && (!customerApp || stage.action === 'NONE'))
          .map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
      </NativeSelect>
      {customerApp ? (
        <p className="text-xs text-muted-foreground sm:col-span-2 sm:col-start-2">
          {t('sales.channelsDialog.customerAppHint')}
        </p>
      ) : null}
      <ProblemAlert problem={action.problem} />
    </div>
  );
}
