import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SalesBoard } from './pipelines-api';

/**
 * The left panel of the warehouse sales page (ADR-0057 #7): the boards, each folding out into the
 * pipelines the user sees, the current one marked. The board holding the current pipeline starts
 * open. Wide screens only; phones choose in the header.
 */
export function WorkPanel({
  boards,
  pipelineId,
  onChoose,
  onHide,
  className,
}: {
  boards: readonly SalesBoard[];
  pipelineId: number | null;
  onChoose: (pipelineId: number) => void;
  onHide: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set());
  const holding = boards.find((board) =>
    board.pipelines.some((pipeline) => pipeline.id === pipelineId),
  )?.id;
  const isOpen = (id: number) => (id === holding) !== toggled.has(id);
  const toggle = (id: number) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <nav
      aria-label={t('sales.work.panel')}
      className={cn('w-60 shrink-0 rounded-xl border border-border bg-card p-2', className)}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('sales.work.boards')}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sales.work.hidePanel')}
          onClick={onHide}
        >
          <PanelLeftClose />
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {boards.map((board) => {
          const open = isOpen(board.id);
          return (
            <li key={board.id}>
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent"
                onClick={() => toggle(board.id)}
              >
                <ChevronRight
                  aria-hidden
                  className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')}
                />
                <span className="truncate">{board.name}</span>
              </button>
              {open ? (
                <ul className="mt-0.5 ml-5 flex flex-col gap-0.5">
                  {board.pipelines.map((pipeline) => {
                    const current = pipeline.id === pipelineId;
                    return (
                      <li key={pipeline.id}>
                        <button
                          type="button"
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                            current && 'bg-secondary font-medium text-secondary-foreground',
                          )}
                          onClick={() => onChoose(pipeline.id)}
                        >
                          {pipeline.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
