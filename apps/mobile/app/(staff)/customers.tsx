import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Search, UserRound, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { problemFrom, unwrap } from '../../src/api/problem';
import { type RepCustomer, useCustomers } from '../../src/api/rep';
import { useSignedIn } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { colors, radii, spacing, TOUCH, type } from '../../src/theme/tokens';
import { EmptyState, ProblemText, Screen } from '../../src/ui/kit';

/** Picks the cart's customer among the active ones (ADR-0061 #5): name, code or phone. */
export default function CustomersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSignedIn();
  const { dispatch } = useShop();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);
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
    <Screen bottom>
      <View style={styles.head}>
        <View style={styles.field}>
          <Search size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.customers.search')}
            placeholderTextColor={colors.muted}
            style={[type.body, styles.input]}
            autoFocus
            autoCorrect={false}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => router.back()}
          style={styles.close}
        >
          <X size={24} color={colors.foreground} />
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(customer) => String(customer.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => void pick(item)}
            style={styles.row}
            disabled={picking !== null}
          >
            <UserRound size={22} color={colors.primary} />
            <View style={styles.grow}>
              <Text style={type.bodyStrong}>{item.name}</Text>
              <Text style={type.caption}>
                {[item.code, item.phone, item.address].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {picking === item.id ? <ActivityIndicator color={colors.primary} /> : null}
          </Pressable>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
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
  close: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    minHeight: 56,
  },
  grow: { flex: 1, gap: 2 },
  loading: { marginTop: spacing.xxl },
});
