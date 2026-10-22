import { ArrowDownUp, ChevronUp, SlidersHorizontal } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStoreCategories } from '../api/customer';
import { formatCount } from '../format/format';
import { toggleId } from '../shop/filters';
import { colors, radii, shadows, spacing, storeType } from '../theme/tokens';
import { ChoiceChip, CountBadge, PillButton, Toggle } from '../ui/controls';
import { Group, Row } from '../ui/grouped';
import { BarButton, SectionHeader } from '../ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { Text } from '../ui/text';
import { topStoreCategories } from './shop';

// «Эрэмбэлэх | Шүүлтүүр» of «Бараа» and a section's full list (ADR-0092 #7; the Shop and
// SectionList boards): the floating pill, the order sheet and the filter sheet.

/**
 * The blue floating pill over a list (the E-mart structure, ADR-0095): «⇅ Эрэмбэлэх ≡ Шүүлтүүр»,
 * with a white count when filters are on, and the round «дээш» at the right once the list is
 * scrolled (`onTop`). `bottom` keeps it above the tab bar on «Бараа».
 */
export function FloatingPill({
  bottom,
  active,
  onSort,
  onFilter,
  onTop,
}: {
  bottom: number;
  /** How many filters are on. */
  active: number;
  onSort: () => void;
  onFilter: () => void;
  /** Back to the top of the list; null hides the button. */
  onTop?: (() => void) | null;
}) {
  const { t } = useTranslation();
  return (
    <View pointerEvents="box-none" style={[styles.pillRow, { bottom }]}>
      {onTop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.customer.list.toTop')}
          onPress={onTop}
          style={({ pressed }) => [styles.top, pressed && styles.pressed]}
        >
          <ChevronUp size={20} strokeWidth={2.4} color={colors.primaryForeground} />
        </Pressable>
      ) : null}
      <View style={styles.pill}>
        <Pressable
          accessibilityRole="button"
          onPress={onSort}
          style={({ pressed }) => [styles.pillButton, pressed && styles.pressed]}
        >
          <ArrowDownUp size={17} strokeWidth={2.2} color={colors.primaryForeground} />
          <Text style={storeType.pill}>{t('mobile.filter.sort')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.shop.filterButton', { n: active })}
          onPress={onFilter}
          style={({ pressed }) => [styles.pillButton, pressed && styles.pressed]}
        >
          <SlidersHorizontal size={17} strokeWidth={2.2} color={colors.primaryForeground} />
          <Text style={storeType.pill}>{t('mobile.filter.title')}</Text>
          {active > 0 ? <CountBadge count={active} ring={colors.primary} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

/** «Эрэмбэлэх»: one order at a time, ✓ on the chosen; a tap chooses and closes. */
export function SortSheet<T extends string>({
  visible,
  options,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  options: readonly { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // As high as its rows: the grabber, the header, a row of 48 each and the group's margins.
  const content = 12 + 50 + options.length * 48 + spacing.sm + spacing.xl + insets.bottom;
  const top = Math.max(62, height - insets.top - content);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={top}
      header={
        <SheetHeader
          title={t('mobile.filter.sort')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.sortBody}>
        <Group>
          {options.map((option) => (
            <Row
              key={option.value}
              title={option.label}
              role="radio"
              checked={option.value === value}
              onPress={() => onPick(option.value)}
              chevron={false}
            />
          ))}
        </Group>
      </ScrollView>
    </Sheet>
  );
}

/** The filters both lists share: the categories (subcategories come with them) and in stock. */
export interface ListFilters {
  categoryIds: number[];
  inStock: boolean;
}

export const NO_LIST_FILTERS: ListFilters = { categoryIds: [], inStock: false };

/** How many filters are on: the categories count as one. */
export function activeFilters(filters: ListFilters): number {
  return (filters.categoryIds.length > 0 ? 1 : 0) + (filters.inStock ? 1 : 0);
}

/**
 * «Шүүлтүүр» on a draft: the top categories, several may be ticked, and «Зөвхөн байгаа бараа»;
 * «N бараа харуулах» counts the draft (`count`, null while asking) and applies it, closing leaves
 * the list as it was. A category chosen elsewhere (a subcategory from a category page) shows too.
 */
export function ListFilterSheet({
  visible,
  draft,
  count,
  onChange,
  onApply,
  onClose,
}: {
  visible: boolean;
  draft: ListFilters;
  count: number | null;
  onChange: (draft: ListFilters) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const categories = useStoreCategories();
  const shown = useMemo(() => {
    const all = categories.data ?? [];
    const top = topStoreCategories(all);
    const extra = all
      .filter(
        (category) =>
          draft.categoryIds.includes(category.id) && !top.some((one) => one.id === category.id),
      )
      .map((category) => ({ id: category.id, name: category.name }));
    return [...extra, ...top];
  }, [categories.data, draft.categoryIds]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      header={
        <SheetHeader
          left={
            <BarButton title={t('mobile.filter.clear')} onPress={() => onChange(NO_LIST_FILTERS)} />
          }
          title={t('mobile.filter.title')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
      footer={
        <PillButton
          title={
            count === null
              ? t('mobile.filter.show')
              : t('mobile.filter.showCount', { n: formatCount(count) })
          }
          onPress={onApply}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.body}>
        <SectionHeader style={styles.first}>{t('mobile.filter.categories')}</SectionHeader>
        <View style={styles.chips}>
          <ChoiceChip
            label={t('common.all')}
            selected={draft.categoryIds.length === 0}
            onPress={() => onChange({ ...draft, categoryIds: [] })}
            onWhite
          />
          {shown.map((category) => (
            <ChoiceChip
              key={category.id}
              label={category.name}
              selected={draft.categoryIds.includes(category.id)}
              onPress={() =>
                onChange({ ...draft, categoryIds: toggleId(draft.categoryIds, category.id) })
              }
              onWhite
            />
          ))}
        </View>
        <Group style={styles.section}>
          <Row
            title={t('mobile.customer.list.inStock')}
            right={
              <Toggle
                value={draft.inStock}
                onChange={(inStock) => onChange({ ...draft, inStock })}
                label={t('mobile.customer.list.inStock')}
              />
            }
            chevron={false}
          />
        </Group>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pillRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderRadius: 22,
    backgroundColor: colors.primary,
    boxShadow: shadows.bluePill,
  },
  pillButton: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  pressed: { opacity: 0.7 },
  top: {
    position: 'absolute',
    right: 14,
    top: 3,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    boxShadow: shadows.bluePill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xl },
  first: { marginTop: spacing.sm },
  section: { marginTop: 22 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
});
