import { useRouter } from 'expo-router';
import { ScanLine, Search, Store } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useCategories, useProducts } from '../../../src/api/rep';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, radii, spacing, TOUCH, type } from '../../../src/theme/tokens';
import { Chip, EmptyState, ProblemText, Screen } from '../../../src/ui/kit';
import { ProductRow } from '../../../src/ui/product-row';

/** Waits for typing to pause before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** «Дэлгүүр»: categories, search by name, code or barcode, the camera, and − n + per unit. */
export default function ShopScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const q = useDebounced(text.trim(), 350);
  const categories = useCategories();
  const products = useProducts(q, categoryId);
  const top = useMemo(
    () => (categories.data ?? []).filter((category) => category.parentId === null),
    [categories.data],
  );
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );

  return (
    <Screen>
      <View style={styles.search}>
        <View style={styles.field}>
          <Search size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.shop.search')}
            placeholderTextColor={colors.muted}
            style={[type.body, styles.input]}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.scan.title')}
          onPress={() => router.push('/scan')}
          style={styles.scan}
        >
          <ScanLine size={22} color={colors.primaryForeground} />
        </Pressable>
      </View>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label={t('common.all')}
            selected={categoryId === null}
            onPress={() => setCategoryId(null)}
          />
          {top.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              selected={categoryId === category.id}
              onPress={() => setCategoryId(category.id)}
            />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(product) => String(product.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            server={server}
            cart={cart}
            dispatch={dispatch}
            locked={pending !== null}
            onOpen={() => router.push(`/product/${item.id}`)}
          />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
        }}
        refreshing={products.isRefetching}
        onRefresh={() => void products.refetch()}
        ListHeaderComponent={
          products.error ? <ProblemText problem={problemFrom(products.error)} /> : null
        }
        ListEmptyComponent={
          products.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <EmptyState
              icon={<Store size={40} color={colors.muted} />}
              title={t('mobile.shop.empty')}
              hint={t('mobile.shop.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          products.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, paddingVertical: spacing.sm },
  scan: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radii.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  loading: { marginTop: spacing.xxl },
});
