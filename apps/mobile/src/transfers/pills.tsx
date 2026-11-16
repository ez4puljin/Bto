import {
  Ban,
  CircleCheck,
  ClipboardCheck,
  type LucideIcon,
  PencilLine,
  Send,
  Truck,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { IconTile } from '../ui/grouped';
import { Pill, type Tone, TONES } from '../ui/staff-kit';
import type { LineState } from './counts';
import { statusKey, type TransferStatus } from './statuses';

/** A status's tone on its pill and its tile: grey, blue, violet, orange, green, red. */
const STATUS_TONES: Record<TransferStatus, Tone> = {
  DRAFT: 'neutral',
  REQUESTED: 'info',
  SHIPPED: 'violet',
  COUNTED: 'warn',
  RECEIVED: 'ok',
  CANCELLED: 'bad',
};

const STATUS_ICONS: Record<TransferStatus, LucideIcon> = {
  DRAFT: PencilLine,
  REQUESTED: Send,
  SHIPPED: Truck,
  COUNTED: ClipboardCheck,
  RECEIVED: CircleCheck,
  CANCELLED: Ban,
};

/** A transfer's or a request's status on its pill (ADR-0116). */
export function TransferStatusPill({ status }: { status: TransferStatus }) {
  const { t } = useTranslation();
  return <Pill label={t(statusKey(status))} tone={STATUS_TONES[status]} />;
}

/** A draft request without a number yet: «Ноорог» on the grey pill. */
export function DraftPill() {
  return <TransferStatusPill status="DRAFT" />;
}

/** The soft tile before a request: its status as an icon in the status's tone. */
export function TransferStatusTile({ status }: { status: TransferStatus }) {
  const Icon = STATUS_ICONS[status];
  const tone = TONES[STATUS_TONES[status]];
  return (
    <IconTile color={tone.background}>
      <Icon size={20} strokeWidth={2} color={tone.text} />
    </IconTile>
  );
}

const LINE_TONES: Record<LineState['kind'], Tone> = {
  unchecked: 'neutral',
  notArrived: 'bad',
  short: 'warn',
  over: 'warn',
  exact: 'ok',
  extra: 'info',
};

/**
 * A shipped line's state as a pill (ADR-0116 #4): «Тоолоогүй» grey, «Ирээгүй» red, «Дутуу» /
 * «Илүү» orange with the difference in base units, «Таарсан» green, «Хүсэлтэд байхгүй» blue.
 */
export function LineStateBadge({ state, baseUnit }: { state: LineState; baseUnit: string }) {
  const { t } = useTranslation();
  const label =
    state.kind === 'short' || state.kind === 'over'
      ? t(`mobile.transfers.receive.states.${state.kind}`, { n: state.diffBase, unit: baseUnit })
      : t(`mobile.transfers.receive.states.${state.kind}`);
  return <Pill label={label} tone={LINE_TONES[state.kind]} />;
}
