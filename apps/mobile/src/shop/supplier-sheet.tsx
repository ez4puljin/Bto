import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { problemFrom } from '../api/problem';
import { useSuppliers } from '../api/rep';
import { formatCount } from '../format/format';
import { AVATAR_TINTS, colors, fonts, radii, spacing, type } from '../theme/tokens';
import { SearchField } from '../ui/controls';
import { Row, Separator } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { BackLink, BarButton } from '../ui/layout';
import { Sheet, SheetHeader } from '../ui/sheet';
import { supplierInitial, toggleId } from './filters';

/**
 * «Нийлүүлэгч» (the Supplier board, ADR-0066): over the filter, the main suppliers of the shop with
 * how many products each has; a search, ticks, «Цэвэрлэх», «Болсон» back to the filter.
 */
export function SupplierSheet({
  visible,
  selected,
  onChange,
  onClose,
}: {
  visible: boolean;
  selected: readonly number[];
  onChange: (supplierIds: number[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const suppliers = useSuppliers(visible);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (suppliers.data ?? [])
      .map((supplier, index) => ({ ...supplier, tint: AVATAR_TINTS[index % AVATAR_TINTS.length] }))
      .filter((supplier) => needle === '' || supplier.name.toLowerCase().includes(needle));
  }, [suppliers.data, q]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('mobile.suppliers.done')}
      top={12}
      header={
        <SheetHeader
          left={<BackLink label={t('mobile.suppliers.back')} onPress={onClose} />}
          title={t('mobile.suppliers.title')}
          right={<BarButton title={t('mobile.suppliers.done')} onPress={onClose} strong />}
        />
      }
    >
      <View style={styles.search}>
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t('mobile.suppliers.search')}
          accessibilityLabel={t('mobile.suppliers.search')}
        />
      </View>
      <View style={styles.head}>
        <Text style={[type.sectionHeader, styles.grow]}>
          {selected.length === 0
            ? t('mobile.suppliers.all')
            : t('mobile.filter.chosen', { n: selected.length })}
        </Text>
        <BarButton title={t('mobile.filter.clear')} onPress={() => onChange([])} />
      </View>
      {suppliers.error ? <ProblemText problem={problemFrom(suppliers.error)} /> : null}
      <FlatList
        data={rows}
        keyExtractor={(supplier) => String(supplier.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cell,
              index === 0 && styles.firstCell,
              index === rows.length - 1 && styles.lastCell,
            ]}
          >
            {index > 0 ? <Separator inset={spacing.lg + 34 + spacing.md} /> : null}
            <Row
              icon={
                <View style={[styles.avatar, { backgroundColor: item.tint }]}>
                  <Text style={styles.initial}>{supplierInitial(item.name)}</Text>
                </View>
              }
              title={item.name}
              subtitle={t('mobile.suppliers.count', { n: formatCount(item.productCount) })}
              role="checkbox"
              checked={selected.includes(item.id)}
              chevron={false}
              minHeight={56}
              onPress={() => onChange(toggleId(selected, item.id))}
            />
          </View>
        )}
        ListEmptyComponent={
          suppliers.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : (
            <Text style={[type.body, styles.empty]}>{t('mobile.suppliers.empty')}</Text>
          )
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: spacing.sm,
    paddingHorizontal: 20,
  },
  grow: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  cell: { backgroundColor: colors.card },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 16,
    color: colors.primaryForeground,
  },
  empty: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted },
  loading: { marginTop: spacing.xl },
});
