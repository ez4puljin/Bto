import type { TFunction } from 'i18next';
import {
  Award,
  Cake,
  CalendarDays,
  type LucideIcon,
  PartyPopper,
  UsersRound,
} from 'lucide-react-native';
import type { CalendarItem } from '../api/community';
import { colors } from '../theme/tokens';
import { IconTile } from '../ui/grouped';
import { Avatar } from './parts';

const KIND_STYLE: Record<CalendarItem['kind'], { Icon: LucideIcon; color: string }> = {
  EVENT: { Icon: CalendarDays, color: colors.tint.blue },
  MEETING: { Icon: UsersRound, color: colors.tint.indigo },
  HOLIDAY: { Icon: PartyPopper, color: colors.tint.red },
  BIRTHDAY: { Icon: Cake, color: colors.tint.pink },
  ANNIVERSARY: { Icon: Award, color: colors.tint.orange },
};

/** A person's picture for a birthday or an anniversary, the kind's tile for anything else. */
export function CalendarItemIcon({ item }: { item: CalendarItem }) {
  if (item.kind === 'BIRTHDAY' || item.kind === 'ANNIVERSARY') {
    return <Avatar name={item.title} photoUrl={item.photoUrl} size={30} />;
  }
  const { Icon, color } = KIND_STYLE[item.kind];
  return (
    <IconTile color={item.typeColor ?? color}>
      <Icon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
    </IconTile>
  );
}

/** «… төрсөн өдөр», «… ажлын N жилийн ой», or the event's own title. */
export function calendarItemTitle(t: TFunction, item: CalendarItem): string {
  if (item.kind === 'BIRTHDAY') {
    return t('mobile.community.calendar.birthday', { name: item.title });
  }
  if (item.kind === 'ANNIVERSARY') {
    return t('mobile.community.calendar.anniversary', { name: item.title, years: item.years ?? 0 });
  }
  return item.title;
}
