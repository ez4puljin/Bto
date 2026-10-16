import { Package, Truck, Warehouse } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useCategories, useProductCount, useRepContext } from '../api/rep';
import { colors, spacing } from '../theme/tokens';
import { ChoiceChip, PillButton, Segmented, Toggle } from '../ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../ui/grouped';
import { BarButton, SectionHeader } from '../ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { EMPTY_FILTERS, type ShopFilters, toggleId, topCategories } from './filters';
import { SupplierSheet } from './supplier-sheet';

const WAREHOUSE_TINTS = [
  colors.tint.blue,
  colors.tint.indigo,
  colors.tint.teal,
  colors.tint.purple,
];

/**
 * «Шүүлтүүр» (the Filter board, ADR-0066): the order, categories, the home warehouse, the
 * suppliers and «Зөвхөн үлдэгдэлтэй» on a draft of the filters; «N бараа харуулах» counts the
 * draft and applies it, closing leaves the shop as it was.
 */
export function FilterSheet({
  visible,
  suppliersFirst,
  filters,
  q,
  onApply,
  onClose,
}: {
  visible: boolean;
  /** Opened from the «Нийлүүлэгч» chip: the supplier list over the filter. */
  suppliersFirst: boolean;
  filters: ShopFilters;
  q: string;
  onApply: (filters: ShopFilters) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const context = useRepContext();
  const categories = useCategories();
  const [draft, setDraft] = useState(filters);
  const [suppliers, setSuppliers] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setDraft(filters);
    setSuppliers(suppliersFirst);
  }, [visible, filters, suppliersFirst]);
  const count = useProductCount({ ...draft, q }, visible);
  const top = useMemo(() => topCategories(categories.data ?? []), [categories.data]);
  const warehouses = context.data?.warehouses ?? [];
  const branches = [...new Set(warehouses.map((warehouse) => warehouse.branchName))];
  const total = count.data;

  const sorts = [
    { value: 'NEW' as const, label: t('mobile.filter.sortNew') },
    { value: 'PRICE_ASC' as const, label: t('mobile.filter.sortPriceAsc') },
    { value: 'PRICE_DESC' as const, label: t('mobile.filter.sortPriceDesc') },
  ];

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        closeLabel={t('common.close')}
        header={
          <SheetHeader
            left={
              <BarButton
                title={t('mobile.filter.clear')}
                onPress={() => setDraft({ ...EMPTY_FILTERS, sort: draft.sort })}
              />
            }
            title={t('mobile.filter.title')}
            right={<SheetClose onPress={onClose} label={t('common.close')} />}
          />
        }
        footer={
          <PillButton
            title={
              total === undefined || total === null
                ? t('mobile.filter.show')
                : total === 0
                  ? t('mobile.filter.none')
                  : t('mobile.filter.showCount', { n: total })
            }
            loading={count.isFetching && total === undefined}
            onPress={() => onApply(draft)}
          />
        }
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

          <SectionHeader style={styles.section}>{t('mobile.filter.location')}</SectionHeader>
          <Group inset={ICON_INSET}>
            <Row
              key="all"
              icon={
                <IconTile color={colors.tint.gray}>
                  <Warehouse size={17} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.filter.allWarehouses')}
              subtitle={branches.join(t('mobile.filter.and'))}
              role="radio"
              checked={draft.warehouseId === null}
              chevron={false}
              onPress={() => setDraft({ ...draft, warehouseId: null })}
            />
            {warehouses.map((warehouse, index) => (
              <Row
                key={warehouse.id}
                icon={
                  <IconTile
                    color={WAREHOUSE_TINTS[index % WAREHOUSE_TINTS.length] ?? colors.tint.blue}
                  >
                    <Warehouse size={17} color={colors.primaryForeground} />
                  </IconTile>
                }
                title={warehouse.name}
                subtitle={t('mobile.filter.homeOf', { branch: warehouse.branchName })}
                role="radio"
                checked={draft.warehouseId === warehouse.id}
                chevron={false}
                onPress={() => setDraft({ ...draft, warehouseId: warehouse.id })}
              />
            ))}
          </Group>

          <SectionHeader style={styles.section}>{t('mobile.filter.suppliers')}</SectionHeader>
          <Group>
            <Row
              icon={
                <IconTile color={colors.tint.orange}>
                  <Truck size={17} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.filter.suppliers')}
              value={
                draft.supplierIds.length === 0
                  ? t('common.all')
                  : t('mobile.filter.chosen', { n: draft.supplierIds.length })
              }
              onPress={() => setSuppliers(true)}
            />
          </Group>

          <Group style={styles.section}>
            <Row
              icon={
                <IconTile color={colors.tint.green}>
                  <Package size={17} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.filter.inStock')}
              right={
                <Toggle
                  value={draft.inStock}
                  onChange={(inStock) => setDraft({ ...draft, inStock })}
                  label={t('mobile.filter.inStock')}
                />
              }
            />
          </Group>
        </ScrollView>
      </Sheet>
      <SupplierSheet
        visible={visible && suppliers}
        selected={draft.supplierIds}
        onChange={(supplierIds) => setDraft({ ...draft, supplierIds })}
        onClose={() => setSuppliers(false)}
      />
    </>
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
