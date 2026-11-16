import { useRouter } from 'expo-router';
import { ChevronRight, PackageCheck, PackageOpen, PackageSearch } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePickWork } from '../../../src/api/picking';
import { problemFrom } from '../../../src/api/problem';
import { shortDate } from '../../../src/dates/dates';
import { initialsOf } from '../../../src/format/format';
import { HeaderSegments } from '../../../src/picking/header-segments';
import { PickStatusPill } from '../../../src/picking/pills';
import { WORK_SECTIONS, type WorkSection, workGroups } from '../../../src/picking/sections';
import type { PickWork } from '../../../src/picking/types';
import { isRep } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { ICON_INSET, IconTile, Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * «Бэлтгэл» (ADR-0132): the keeper's parts from `GET /sales-picks`, in four lists — to take, mine,
 * others', done today — one shown at a time, chosen on the header's segmented control whose labels
 * carry the counts (it opens on the first list that has rows). Each row is the order's number and
 * the part's pill, the customer, the warehouse, «N бараа» and the delivery date; a tap opens the
 * part. Pull to refresh; the list re-reads every 15 s. Opened from «Нүүр» or «Цэс» (ADR-0174); a
 * rep has the initials to the profile.
 */
export default function PickingHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const work = usePickWork();
  const sections = useMemo(() => workGroups(work.data ?? [], me.id), [work.data, me.id]);
  const [chosen, setChosen] = useState<WorkSection | null>(null);
  // Until the keeper picks a list, the first one with rows shows.
  const shown = chosen ?? sections[0]?.key ?? 'take';
  const rows = sections.find((section) => section.key === shown)?.data ?? [];
  const countOf = (key: WorkSection) =>
    sections.find((section) => section.key === key)?.data.length ?? 0;

  const renderRow = ({ item, index }: { item: PickWork; index: number }) => (
    <View
      style={[
        styles.cell,
        index === 0 && styles.firstCell,
        index === rows.length - 1 && styles.lastCell,
      ]}
    >
      {index > 0 ? <Separator inset={ICON_INSET} /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/picking/${item.orderId}?warehouse=${item.warehouseId}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {item.status === 'DONE' ? (
          <IconTile color={colors.successSoft}>
            <PackageCheck size={20} strokeWidth={2} color={colors.success} />
          </IconTile>
        ) : item.status === 'PICKING' && item.pickerId === me.id ? (
          <IconTile color={colors.tint.orange}>
            <PackageOpen size={20} strokeWidth={2} color={colors.primaryForeground} />
          </IconTile>
        ) : (
          <IconTile color={colors.warningSoft}>
            <PackageOpen size={20} strokeWidth={2} color={colors.warning} />
          </IconTile>
        )}
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
        <ChevronRight size={18} strokeWidth={2.4} color={colors.input} style={styles.chevron} />
      </Pressable>
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.picking.title')}
        onBack={() => router.back()}
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
      >
        <HeaderSegments
          label={t('mobile.picking.title')}
          options={WORK_SECTIONS.map((key) => ({
            value: key,
            label:
              countOf(key) > 0
                ? t('mobile.picking.tabCount', {
                    label: t(`mobile.picking.tabs.${key}`),
                    n: countOf(key),
                  })
                : t(`mobile.picking.tabs.${key}`),
          }))}
          value={shown}
          onChange={setChosen}
        />
      </StoreHeader>
      <FlatList<PickWork>
        data={rows}
        keyExtractor={(row) => `${row.orderId}:${row.warehouseId}`}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs },
        ]}
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
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
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
  list: { padding: spacing.lg, flexGrow: 1 },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  chevron: { marginTop: spacing.sm },
  loading: { marginTop: spacing.xl },
});
