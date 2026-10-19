import { Image } from 'expo-image';
import { Package, Store } from 'lucide-react-native';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { problemFrom } from '../api/problem';
import { useCustomers, useProducts } from '../api/rep';
import { EMPTY_FILTERS } from '../shop/filters';
import { useSignedIn } from '../state/session';
import { useDebounced } from '../state/use-debounced';
import { colors, radii, spacing } from '../theme/tokens';
import { SearchField } from '../ui/controls';
import { Group, IconTile, Row, Separator } from '../ui/grouped';
import { EmptyState, ProblemText } from '../ui/kit';
import { BackLink, BarButton } from '../ui/layout';
import { Sheet, SheetHeader } from '../ui/sheet';
import type { PickedRecord } from './order-filters';

const THUMB = 40;

export interface PickSheetProps {
  visible: boolean;
  selected: PickedRecord | null;
  /** A record, or null for every one («Бүх харилцагч»). */
  onPick: (record: PickedRecord | null) => void;
  onClose: () => void;
}

/**
 * Over the order filter: a search, «Бүх …» and the records, the chosen one ticked; a tap picks
 * and goes back to the filter. The list asks the server only while the sheet is open.
 */
export function PickSheet({
  visible,
  selected,
  onPick,
  onClose,
  title,
  children,
}: PickSheetProps & { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={12}
      header={
        <SheetHeader
          left={<BackLink label={t('mobile.filter.title')} onPress={onClose} />}
          title={title}
          right={
            <BarButton
              title={t('mobile.filter.clear')}
              onPress={() => onPick(null)}
              disabled={selected === null}
            />
          }
        />
      }
    >
      {children}
    </Sheet>
  );
}

/** One grouped list: «Бүх …» on its own, then the records the search finds, page by page. */
export function PickList<T extends { id: number }>({
  rows,
  query,
  search,
  allTitle,
  allIcon,
  emptyTitle,
  selected,
  onPick,
  inset,
  renderRow,
}: {
  rows: readonly T[];
  query: {
    error: unknown;
    isLoading: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
  search: ReactNode;
  allTitle: string;
  allIcon: ReactNode;
  emptyTitle: string;
  selected: PickedRecord | null;
  onPick: (record: PickedRecord | null) => void;
  inset: number;
  renderRow: (item: T) => ReactNode;
}) {
  return (
    <>
      <View style={styles.search}>{search}</View>
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {query.error ? <ProblemText problem={problemFrom(query.error)} /> : null}
            <Group style={styles.all}>
              <Row
                icon={allIcon}
                title={allTitle}
                role="radio"
                checked={selected === null}
                chevron={false}
                minHeight={52}
                onPress={() => onPick(null)}
              />
            </Group>
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cell,
              index === 0 && styles.firstCell,
              index === rows.length - 1 && styles.lastCell,
            ]}
          >
            {index > 0 ? <Separator inset={inset} /> : null}
            {renderRow(item)}
          </View>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListEmptyComponent={
          query.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : (
            <EmptyState title={emptyTitle} />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : null
        }
      />
    </>
  );
}

function CustomerList({ selected, onPick }: Pick<PickSheetProps, 'selected' | 'onPick'>) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const customers = useCustomers(useDebounced(text.trim(), 350));
  const rows = useMemo(
    () => customers.data?.pages.flatMap((page) => page.data) ?? [],
    [customers.data],
  );
  const tile = (color: string) => (
    <IconTile color={color}>
      <Store size={17} color={colors.primaryForeground} />
    </IconTile>
  );
  return (
    <PickList
      rows={rows}
      query={customers}
      search={
        <SearchField
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.customers.search')}
          accessibilityLabel={t('mobile.customers.search')}
        />
      }
      allTitle={t('mobile.orderFilter.anyCustomer')}
      allIcon={tile(colors.tint.gray)}
      emptyTitle={t('mobile.customers.empty')}
      selected={selected}
      onPick={onPick}
      inset={spacing.lg + 30 + spacing.md}
      renderRow={(customer) => (
        <Row
          icon={tile(colors.tint.blue)}
          title={customer.name}
          subtitle={[t('mobile.checkout.code', { code: customer.code }), customer.phone]
            .filter(Boolean)
            .join(' · ')}
          role="radio"
          checked={selected?.id === customer.id}
          chevron={false}
          minHeight={56}
          onPress={() => onPick({ id: customer.id, name: customer.name })}
        />
      )}
    />
  );
}

function ProductList({ selected, onPick }: Pick<PickSheetProps, 'selected' | 'onPick'>) {
  const { t } = useTranslation();
  const { server } = useSignedIn();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const products = useProducts({ ...EMPTY_FILTERS, q });
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  return (
    <PickList
      rows={rows}
      query={products}
      search={
        <SearchField
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.orderFilter.productSearch')}
          accessibilityLabel={t('mobile.orderFilter.productSearch')}
        />
      }
      allTitle={t('mobile.orderFilter.anyProduct')}
      allIcon={
        <IconTile color={colors.tint.gray}>
          <Package size={17} color={colors.primaryForeground} />
        </IconTile>
      }
      emptyTitle={t('mobile.orderFilter.productsEmpty')}
      selected={selected}
      onPick={onPick}
      inset={spacing.lg + THUMB + spacing.md}
      renderRow={(product) => (
        <Row
          icon={
            <View style={styles.thumb}>
              {product.thumbUrl ? (
                <Image
                  source={{ uri: `${server}${product.thumbUrl}` }}
                  style={styles.image}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={product.thumbUrl}
                />
              ) : (
                <Package size={20} strokeWidth={1.5} color={colors.input} />
              )}
            </View>
          }
          title={product.name}
          subtitle={t('mobile.checkout.code', { code: product.sku })}
          role="radio"
          checked={selected?.id === product.id}
          chevron={false}
          minHeight={60}
          onPress={() => onPick({ id: product.id, name: product.name })}
        />
      )}
    />
  );
}

/** «Харилцагч сонгох»: the active customers by name, code or phone. */
export function CustomerPickSheet(props: PickSheetProps) {
  const { t } = useTranslation();
  return (
    <PickSheet {...props} title={t('mobile.orderFilter.pickCustomer')}>
      <CustomerList selected={props.selected} onPick={props.onPick} />
    </PickSheet>
  );
}

/** «Бараа сонгох»: the shop's products by name or code, with their pictures. */
export function ProductPickSheet(props: PickSheetProps) {
  const { t } = useTranslation();
  return (
    <PickSheet {...props} title={t('mobile.orderFilter.pickProduct')}>
      <ProductList selected={props.selected} onPick={props.onPick} />
    </PickSheet>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  all: { marginBottom: spacing.lg },
  cell: { backgroundColor: colors.card },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.control,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  loading: { marginTop: spacing.xl },
});
