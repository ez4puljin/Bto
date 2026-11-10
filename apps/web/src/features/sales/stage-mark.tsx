import type { StageAction } from '@tugeel/shared/sales';
import { useTranslation } from 'react-i18next';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { STAGE_TONES } from './stage-tones';

/**
 * A stage's action as a small pill («Нөөцлөнө», «Борлуулна», …) with the action's hint on hover
 * and keyboard focus; nothing for a stage without an action (ADR-0129 #3).
 */
export function StageMark({ action, className }: { action: StageAction; className?: string }) {
  const { t } = useTranslation();
  if (action === 'NONE') return null;
  const tone = STAGE_TONES[action];
  if (!tone) return null;
  const Icon = tone.icon;
  const label = t(`sales.stageMarks.${action}`);
  const hint = t(`sales.stageActionHints.${action}`);
  return (
    <Hint label={hint}>
      <span
        tabIndex={0}
        aria-label={`${label}: ${hint}`}
        data-action={action}
        className={cn(
          'inline-flex h-5.5 w-fit shrink-0 cursor-default items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
          tone.mark,
          className,
        )}
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </span>
    </Hint>
  );
}
