import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Check, Store } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { problemFrom, unwrap } from '../../src/api/problem';
import { type RepCustomer, useCustomers } from '../../src/api/rep';
import { useSignedIn } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { useDebounced } from '../../src/state/use-debounced';
import { colors, radii, spacing, type } from '../../src/theme/tokens';
import { SearchField } from '../../src/ui/controls';
import { Separator } from '../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { BarButton, LargeTitle, Page } from '../../src/ui/layout';

/**
 * Picks the cart's customer among the active ones (ADR-0061 #5): name, code or phone. The pick
 * brings the default address and, for an empty contact, the customer's first contact (ADR-0066).
 */
export default function CustomersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
      const contact = detail.contacts.find((entry) => entry.name || entry.phone);
      dispatch({
        type: 'customer',
        customer: { id: detail.id, code: detail.code, name: detail.name },
        defaultAddressId: preferred?.id ?? null,
        contact: contact ?? (detail.phone ? { name: null, phone: detail.phone } : null),
      });
      router.back();
    } catch {
      setPicking(null);
    }
  };

  return (
    <Page edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <BarButton title={t('common.cancel')} onPress={() => router.back()} />
      </View>
      <LargeTitle style={styles.title}>{t('mobile.customers.title')}</LargeTitle>
      <View style={styles.search}>
        <SearchField
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.customers.search')}
          accessibilityLabel={t('mobile.customers.search')}
          autoFocus
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(customer) => String(customer.id)}
        contentContainerStyle={styles.list}
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
  bar: { height: 44, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  title: { marginHorizontal: 20, marginTop: 2 },
  search: { paddingHorizontal: spacing.lg, paddingTop: 10 },
  list: { padding: spacing.lg },
  cell: { backgroundColor: colors.card },
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
