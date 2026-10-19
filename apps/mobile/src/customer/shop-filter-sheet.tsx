import type { RepProductSort } from '@tugeel/shared/sales';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useStoreCategories } from '../api/customer';
import { toggleId } from '../shop/filters';
import { colors, spacing } from '../theme/tokens';
import { ChoiceChip, PillButton, Segmented } from '../ui/controls';
import { BarButton, SectionHeader } from '../ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { topStoreCategories } from './shop';

export interface StoreShopFilters {
  sort: RepProductSort;
  categoryIds: number[];
}

/**
 * «Шүүлтүүр» of «Бараа» (the Shop board's filter button, «Ангилал» and the order chip): the order
 * and the top categories, several may be ticked, on a draft; «Бараа харуулах» applies it, closing
 * leaves the shop as it was.
 */
export function ShopFilterSheet({
  visible,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: StoreShopFilters;
  onApply: (filters: StoreShopFilters) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const categories = useStoreCategories();
  const [draft, setDraft] = useState(filters);
  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);
  const top = useMemo(() => topStoreCategories(categories.data ?? []), [categories.data]);

  const sorts = [
    { value: 'NEW' as const, label: t('mobile.filter.sortNew') },
    { value: 'PRICE_ASC' as const, label: t('mobile.filter.sortPriceAsc') },
    { value: 'PRICE_DESC' as const, label: t('mobile.filter.sortPriceDesc') },
  ];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      header={
        <SheetHeader
          left={
            <BarButton
              title={t('mobile.filter.clear')}
              onPress={() => setDraft({ sort: 'NEW', categoryIds: [] })}
            />
          }
          title={t('mobile.filter.title')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
      footer={<PillButton title={t('mobile.filter.show')} onPress={() => onApply(draft)} />}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <SectionHeader style={styles.first}>{t('mobile.filter.sort')}</SectionHeader>
        <Segmented
          options={sorts}
          value={draft.sort}
          onChange={(sort) => setDraft({ ...draft, sort })}
          height={40}
          small
          label={t('mobile.filter.sort')}
        />

        <SectionHeader style={styles.section}>{t('mobile.filter.categories')}</SectionHeader>
        <View style={styles.chips}>
          <ChoiceChip
            label={t('common.all')}
            selected={draft.categoryIds.length === 0}
            onPress={() => setDraft({ ...draft, categoryIds: [] })}
            onWhite
          />
          {top.map((category) => (
            <ChoiceChip
              key={category.id}
              label={category.name}
              selected={draft.categoryIds.includes(category.id)}
              onPress={() =>
                setDraft({ ...draft, categoryIds: toggleId(draft.categoryIds, category.id) })
              }
              onWhite
            />
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xl },
  first: { marginTop: spacing.sm },
  section: { marginTop: 22 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.card,
  },
});
