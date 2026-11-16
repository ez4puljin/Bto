import { MapPin } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pill, type Tone } from '../ui/staff-kit';
import type { LineCountState } from './sections';
import type { PickStatus } from './types';

/** A part's tone as the web draws it (ADR-0126 #2): grey, orange, green. */
const PART_TONES: Record<PickStatus, Tone> = { OPEN: 'neutral', PICKING: 'warn', DONE: 'ok' };

export function PickStatusPill({ status }: { status: PickStatus }) {
  const { t } = useTranslation();
  return <Pill label={t(`mobile.picking.status.${status}`)} tone={PART_TONES[status]} />;
}

const LINE_TONES: Record<LineCountState['kind'], Tone> = {
  uncounted: 'neutral',
  out: 'bad',
  short: 'warn',
  full: 'ok',
};

/** A line's count as a pill: «Тоолоогүй» grey, «Дууссан» red, «Дутуу n» orange, «Бүтэн» green. */
export function LineCountBadge({ state, baseUnit }: { state: LineCountState; baseUnit: string }) {
  const { t } = useTranslation();
  const label =
    state.kind === 'short'
      ? t('mobile.picking.part.states.short', { n: state.diffBase, unit: baseUnit })
      : t(`mobile.picking.part.states.${state.kind}`);
  return <Pill label={label} tone={LINE_TONES[state.kind]} />;
}

/** A line's shelf as a blue pill with the pin; grey when the line has none. */
export function ShelfPill({ label, none = false }: { label: string; none?: boolean }) {
  return <Pill label={label} tone={none ? 'neutral' : 'info'} icon={MapPin} />;
}
