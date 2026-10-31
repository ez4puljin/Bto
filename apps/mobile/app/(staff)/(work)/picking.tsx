import { useRouter } from 'expo-router';
import { ChevronRight, PackageSearch } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePickWork } from '../../../src/api/picking';
import { problemFrom } from '../../../src/api/problem';
import { shortDate } from '../../../src/dates/dates';
import { initialsOf } from '../../../src/format/format';
import { PickStatusPill } from '../../../src/picking/pills';
import { type WorkGroup, workGroups } from '../../../src/picking/sections';
import type { PickWork } from '../../../src/picking/types';
import { isRep } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text } from '../../../src/ui/text';

/**
 * «Бэлтгэл» (ADR-0132): the keeper's parts from `GET /sales-picks`, in sections — to take, mine,
 * others', done today — each row the order's number and the part's pill, the customer, the
 * warehouse, «N бараа» and the delivery date; a tap opens the part. Pull to refresh; the list
 * re-reads every 15 s. A tab of the work menu; a rep opens it from «Нүүр» (the back arrow, the
 * initials to the profile).
 */
export default function PickingHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const barInset = useStoreTabBarInset();
  const work = usePickWork();
  const sections = useMemo(() => workGroups(work.data ?? [], me.id), [work.data, me.id]);

  const renderRow = ({
    item,
    index,
    section,
  }: {
    item: PickWork;
    index: number;
    section: WorkGroup;
  }) => (
    <View
      style={[
        styles.cell,
        index === 0 && styles.firstCell,
        index === section.data.length - 1 && styles.lastCell,
      ]}
    >
      {index > 0 ? <Separator /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/picking/${item.orderId}?warehouse=${item.warehouseId}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.grow}>
          <View style={styles.rowTop}>
            <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
              {item.orderNumber ?? t('mobile.picking.draftNo', { id: item.orderId })}
            </Text>
            <PickStatusPill status={item.status} />
          </View>
          <Text style={type.row} numberOfLines={1}>
            {item.customerName}
          </Text>
          <Text style={type.secondary} numberOfLines={1}>
            {[
              item.warehouseName,
              t('mobile.picking.items', { n: item.lines }),
              t('mobile.picking.deliver', { date: shortDate(item.deliveryDate) }),
              item.pickerName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
      </Pressable>
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.picking.title')}
        {...(rep ? { onBack: () => router.back() } : {})}
        right={
          rep ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.tabs.profile')}
              onPress={() => router.push('/profile')}
              hitSlop={7}
              style={({ pressed }) => [styles.avatar, pressed && styles.faded]}
            >
              <Text style={styles.avatarText}>{initialsOf(me.fullName)}</Text>
            </Pressable>
          ) : null
        }
      />
      <SectionList<PickWork, WorkGroup>
        sections={sections}
        keyExtractor={(row) => `${row.orderId}:${row.warehouseId}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: rep ? Math.max(insets.bottom, spacing.md) : barInset },
        ]}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[type.sectionHeader, styles.sectionHeader]}>
            {t(`mobile.picking.sections.${section.key}`, { n: section.data.length })}
          </Text>
        )}
        renderItem={renderRow}
        refreshing={work.isRefetching}
        onRefresh={() => void work.refetch()}
        ListEmptyComponent={
          work.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : work.error ? (
            <ProblemText problem={problemFrom(work.error)} />
          ) : (
            <EmptyState
              icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.picking.empty')}
              hint={t('mobile.picking.emptyHint')}
            />
          )
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 2 },
  pressed: { backgroundColor: colors.accent },
  faded: { opacity: 0.7 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...type.secondary, color: colors.primary, fontFamily: fonts.bold },
  list: { paddingHorizontal: 14, flexGrow: 1 },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, paddingHorizontal: 2 },
  cell: { backgroundColor: colors.card },
  firstCell: {
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    overflow: 'hidden',
  },
  lastCell: {
    borderBottomLeftRadius: radii.card,
    borderBottomRightRadius: radii.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  loading: { marginTop: spacing.xl },
});
