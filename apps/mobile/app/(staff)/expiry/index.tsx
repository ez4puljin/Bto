import { useRouter } from 'expo-router';
import { CalendarClock, ScanLine, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { type ExpiryItem, useExpiryItems, useExpirySummary } from '../../../src/api/expiry';
import { problemFrom } from '../../../src/api/problem';
import { ExpiryRecordRow, HeaderSearch } from '../../../src/expiry/parts';
import {
  chipCount,
  EXPIRY_CHIPS,
  type ExpiryChip,
  isAwaitingRows,
} from '../../../src/expiry/rules';
import { formatCount } from '../../../src/format/format';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, radii, spacing } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { FooterBar } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { useKeyboardShown } from '../../../src/ui/store-tab-bar';

/** A 32 px chip pressed over 44 px: the row leaves that room above and below it. */
const CHIP_SLOP = { top: 6, bottom: 6 };

/**
 * «Хугацаа илрүүлэлт» (ADR-0172 #9): the search, the chips with the summary's counts, the records
 * soonest first in one grouped list (a tile with the days left in the urgency's tone, the product
 * and its status, the code and the date, the two counts and the total), and «Скан хийж бүртгэх» in
 * the bar under the page to write a new one (that page also searches by name). Opened from «Нүүр» or «Цэс» by everyone (ADR-0174),
 * with the back arrow.
 */
export default function ExpiryHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const keyboard = useKeyboardShown();
  const [chip, setChip] = useState<ExpiryChip>('ACTIVE');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const summary = useExpirySummary();
  const items = useExpiryItems(chip, q);
  const rows = useMemo(() => (items.data?.pages ?? []).flatMap((page) => page.data), [items.data]);
  const awaiting = isAwaitingRows(items, rows.length);

  const renderItem = ({ item, index }: { item: ExpiryItem; index: number }) => (
    <View
      style={[
        styles.cell,
        index === 0 && styles.firstCell,
        index === rows.length - 1 && styles.lastCell,
      ]}
    >
      {index > 0 ? <Separator inset={spacing.lg + 52 + spacing.md} /> : null}
      <ExpiryRecordRow item={item} onPress={() => router.push(`/expiry/${item.id}`)} />
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.expiry.title')} onBack={() => router.back()} right={null}>
        <HeaderSearch
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.expiry.search')}
          label={t('mobile.shop.searchLabel')}
          onScan={() => router.push('/expiry/new?scan=1')}
          scanLabel={t('mobile.expiry.scanNew')}
        />
      </StoreHeader>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {EXPIRY_CHIPS.map((entry) => {
          const label = t(`mobile.expiry.chips.${entry}`);
          return (
            <ChoiceChip
              key={entry}
              compact
              onWhite={false}
              hitSlop={CHIP_SLOP}
              label={
                summary.data
                  ? t('mobile.expiry.chipCount', {
                      label,
                      n: formatCount(chipCount(summary.data, entry)),
                    })
                  : label
              }
              selected={chip === entry}
              onPress={() => setChip(entry)}
            />
          );
        })}
      </ScrollView>

      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        style={styles.fill}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (items.hasNextPage && !items.isFetchingNextPage) void items.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={items.isRefetching && !items.isFetchingNextPage && !awaiting}
            onRefresh={() => {
              void summary.refetch();
              void items.refetch();
            }}
          />
        }
        ListEmptyComponent={
          awaiting ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : items.error ? (
            <View style={styles.failed}>
              <ProblemText problem={problemFrom(items.error)} />
              <PillButton
                title={t('common.retry')}
                variant="soft"
                onPress={() => void items.refetch()}
              />
            </View>
          ) : q !== '' ? (
            <EmptyState
              icon={<Search size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.expiry.emptySearch')}
            />
          ) : (
            <EmptyState
              icon={<CalendarClock size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.expiry.empty')}
              hint={t('mobile.expiry.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          items.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />

      {keyboard ? null : (
        <FooterBar>
          <PillButton
            title={t('mobile.expiry.scanNew')}
            icon={<ScanLine size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
            style={styles.fill}
            onPress={() => router.push('/expiry/new?scan=1')}
          />
        </FooterBar>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // A ScrollView shrinks by default: beside a long list it lost its lower padding to the list.
  chipRow: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  loading: { marginTop: spacing.xl },
  failed: { gap: spacing.md },
});
