import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Check, Search, Store } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from '../../src/ui/text';
import { problemFrom, unwrap } from '../../src/api/problem';
import { type RepCustomer, useCustomers } from '../../src/api/rep';
import { useSignedIn } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { useDebounced } from '../../src/state/use-debounced';
import { colors, radii, spacing, storeType, TOUCH, type } from '../../src/theme/tokens';
import { Separator } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';
import { StoreHeader } from '../../src/ui/store-header';

/**
 * Picks the cart's customer among the active ones (ADR-0061 #5): name, code or phone. The pick
 * brings the default address (ADR-0068); the order takes no contact person (the owner, 2026-10-18).
 * Bto300's blue header with ← and the search field in the band, like its shop (ADR-0100).
 */
export default function CustomersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { session } = useSignedIn();
  const { cart, dispatch } = useShop();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const [picking, setPicking] = useState<number | null>(null);
  const customers = useCustomers(q);
  const rows = useMemo(
    () => customers.data?.pages.flatMap((page) => page.data) ?? [],
    [customers.data],
  );

  const pick = async (customer: RepCustomer) => {
    setPicking(customer.id);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: ['rep', 'customer', customer.id],
        queryFn: async () =>
          unwrap(
            await session.client.GET('/api/v1/sales-rep/customers/{id}', {
              params: { path: { id: customer.id } },
            }),
          ),
      });
      const preferred =
        detail.addresses.find((address) => address.isDefault) ?? detail.addresses[0];
      dispatch({
        type: 'customer',
        customer: { id: detail.id, code: detail.code, name: detail.name },
        defaultAddressId: preferred?.id ?? null,
      });
      router.back();
    } catch {
      setPicking(null);
    }
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.customers.title')} onBack={() => router.back()} right={null}>
        <View style={styles.search}>
          <Search size={17} strokeWidth={2.2} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.customers.search')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('mobile.customers.search')}
            autoCorrect={false}
            returnKeyType="search"
            autoFocus
            style={[storeType.search, styles.searchInput]}
          />
        </View>
      </StoreHeader>
      <FlatList
        data={rows}
        keyExtractor={(customer) => String(customer.id)}
        contentContainerStyle={[styles.list, { paddingBottom: spacing.lg + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cell,
              index === 0 && styles.firstCell,
              index === rows.length - 1 && styles.lastCell,
            ]}
          >
            {index > 0 ? <Separator inset={spacing.lg + 34 + spacing.md} /> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void pick(item)}
              disabled={picking !== null}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.icon}>
                <Store size={18} strokeWidth={2} color={colors.primaryForeground} />
              </View>
              <View style={styles.grow}>
                <Text style={type.row} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={type.secondary} numberOfLines={1}>
                  {[t('mobile.checkout.code', { code: item.code }), item.phone, item.address]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {picking === item.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : cart.customer?.id === item.id ? (
                <Check size={20} strokeWidth={2.6} color={colors.primary} />
              ) : null}
            </Pressable>
          </View>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (customers.hasNextPage && !customers.isFetchingNextPage)
            void customers.fetchNextPage();
        }}
        ListHeaderComponent={
          customers.error ? <ProblemText problem={problemFrom(customers.error)} /> : null
        }
        ListEmptyComponent={
          customers.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <EmptyState title={t('mobile.customers.empty')} />
          )
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  // Bto300's shop search: a white 34 px field in the blue band.
  search: {
    height: 34,
    marginHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minWidth: 0, height: TOUCH, padding: 0, color: colors.foreground },
  list: { padding: spacing.lg },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  pressed: { backgroundColor: colors.accent },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, gap: 1 },
  loading: { marginTop: spacing.xxl },
});
