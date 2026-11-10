import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  ArrowLeftRight,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  ClipboardPen,
  HeartHandshake,
  History,
  IdCard,
  type LucideIcon,
  MapPin,
  MessageSquareText,
  Newspaper,
  PackageCheck,
  Send,
  MapPinned,
  Truck,
  ShoppingBag,
  UserRound,
  UsersRound,
  Vote,
  Megaphone,
} from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import { feedCount, useFeed, useToday } from '../api/community';
import { useNotificationSummary } from '../api/notifications';
import { readJson, userKey, writeJson } from '../device/storage';
import { isRep } from '../state/phase';
import { useSignedIn } from '../state/session';
import { colors } from '../theme/tokens';
import {
  favouritesOf,
  type MenuGroup,
  type MenuItem,
  type MenuKey,
  menuOf,
  toggledFavourites,
} from './menu';

/** Each menu row's icon and its tile's colour. */
export const MENU_LOOK: Record<MenuKey, { Icon: LucideIcon; color: string }> = {
  rep: { Icon: ShoppingBag, color: colors.tint.blue },
  picking: { Icon: PackageCheck, color: colors.tint.orange },
  loading: { Icon: Truck, color: colors.tint.brown },
  visits: { Icon: MapPinned, color: colors.tint.green },
  transfers: { Icon: ArrowLeftRight, color: colors.tint.teal },
  expiry: { Icon: CalendarClock, color: colors.tint.red },
  counts: { Icon: ClipboardList, color: colors.tint.purple },
  attendance: { Icon: CalendarCheck, color: colors.tint.green },
  attendanceRequests: { Icon: ClipboardPen, color: colors.tint.orange },
  attendanceHistory: { Icon: History, color: colors.tint.blue },
  community: { Icon: UsersRound, color: colors.tint.indigo },
  notices: { Icon: Megaphone, color: colors.tint.red },
  news: { Icon: Newspaper, color: colors.tint.blue },
  polls: { Icon: Vote, color: colors.tint.indigo },
  calendar: { Icon: CalendarDays, color: colors.tint.orange },
  thanks: { Icon: HeartHandshake, color: colors.tint.pink },
  feedback: { Icon: MessageSquareText, color: colors.tint.teal },
  location: { Icon: MapPin, color: colors.tint.green },
  myDetails: { Icon: IdCard, color: colors.tint.gray },
  repNotifications: { Icon: Bell, color: colors.tint.red },
  repSettings: { Icon: Send, color: colors.tint.orange },
  profile: { Icon: UserRound, color: colors.tint.gray },
};

/** The person's menu, the unread counts on its rows, and opening a row. */
export function useStaffMenu(): {
  groups: MenuGroup[];
  countOf: (key: MenuKey) => number;
  open: (item: MenuItem) => void;
} {
  const router = useRouter();
  const { me } = useSignedIn();
  const today = useToday();
  const feed = useFeed().data;
  const unread = useNotificationSummary(isRep(me)).data?.unread ?? 0;
  const groups = useMemo(() => menuOf(me), [me]);
  const countOf = useCallback(
    (key: MenuKey): number => {
      switch (key) {
        case 'community':
          return feedCount(feed);
        case 'notices':
          return feed?.unreadNotices ?? 0;
        case 'news':
          return feed?.unreadNews ?? 0;
        case 'polls':
          return feed?.openPolls ?? 0;
        case 'repNotifications':
          return unread;
        default:
          return 0;
      }
    },
    [feed, unread],
  );
  const open = useCallback(
    (item: MenuItem) => {
      // The attendance's pages count their days from the server's today.
      const dated = item.key === 'attendanceRequests' || item.key === 'attendanceHistory';
      router.push(dated ? `${item.href}?today=${today}` : item.href);
    },
    [router, today],
  );
  return { groups, countOf, open };
}

/**
 * The favourites are this person's on this phone (ADR-0174 #3). Held in the query cache, so «Нүүр»
 * and «Цэс», both open behind the tabs, change together.
 */
export function useFavourites(groups: readonly MenuGroup[]): {
  favourites: MenuItem[];
  isFavourite: (key: MenuKey) => boolean;
  toggle: (key: MenuKey) => void;
} {
  const { me, server } = useSignedIn();
  const queryClient = useQueryClient();
  const storageKey = userKey('favourites', server, me.id);
  const queryKey = useMemo(() => ['staff', 'favourites', storageKey], [storageKey]);
  const stored = useQuery({
    queryKey,
    queryFn: () => readJson(storageKey),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  }).data;
  const favourites = useMemo(() => favouritesOf(stored ?? null, groups), [stored, groups]);
  const isFavourite = useCallback(
    (key: MenuKey) => favourites.some((item) => item.key === key),
    [favourites],
  );
  const toggle = useCallback(
    (key: MenuKey) => {
      const next = toggledFavourites(
        favourites.map((item) => item.key),
        key,
      );
      queryClient.setQueryData(queryKey, next);
      void writeJson(storageKey, next);
    },
    [favourites, queryClient, queryKey, storageKey],
  );
  return { favourites, isFavourite, toggle };
}
