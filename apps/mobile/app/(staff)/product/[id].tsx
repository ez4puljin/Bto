import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Package } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useProductsOf } from '../../../src/api/rep';
import { qtyOf } from '../../../src/cart/cart';
import { formatMnt, formatQty } from '../../../src/format/format';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { Button, Card, EmptyState, ProblemText, Screen, Stepper, Title } from '../../../src/ui/kit';
import { addLine, useStockText } from '../../../src/ui/product-row';

/** One product: its picture, each unit's price, the stock, and − n + per unit. */
export default function ProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number.parseInt(id ?? '', 10);
  const { server } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
  const stockText = useStockText();
  const query = useProductsOf(Number.isSafeInteger(productId) ? [productId] : []);
  const product = query.data?.[0];

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ChevronLeft size={24} color={colors.primary} />
        <Text style={[type.body, { color: colors.link }]}>{t('common.back')}</Text>
      </Pressable>
      {query.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {query.error ? <ProblemText problem={problemFrom(query.error)} /> : null}
      {query.isSuccess && !product ? (
        <EmptyState
          icon={<Package size={40} color={colors.muted} />}
          title={t('mobile.shop.gone')}
        />
      ) : null}
      {product ? (
        <ScrollView contentContainerStyle={styles.body}>
          {product.thumbUrl ? (
            <Image
              source={{ uri: `${server}${product.thumbUrl}` }}
              style={styles.image}
              contentFit="contain"
            />
          ) : null}
          <Title>{product.name}</Title>
          <Text style={type.secondary}>{product.sku}</Text>
          <Text
            style={[type.body, { color: product.sellable ? colors.success : colors.destructive }]}
          >
            {product.sellable ? stockText(product) : t('mobile.shop.notSellable')}
          </Text>
          {product.units.map((unit) => (
            <Card key={unit.id} style={styles.unit}>
              <View style={styles.grow}>
                <Text style={type.bodyStrong}>{unit.uomName}</Text>
                <Text style={type.caption}>
                  {unit.isBase
                    ? t('mobile.shop.baseUnit')
                    : t('mobile.shop.packOf', { n: formatQty(unit.factorToBase) })}
                </Text>
                <Text style={type.body}>
                  {unit.wholesale
                    ? t('pricing.money', { amount: formatMnt(unit.wholesale) })
                    : t('mobile.shop.noPrice', { unit: unit.uomName })}
                </Text>
              </View>
              {product.sellable && unit.wholesale && pending === null ? (
                <Stepper
                  label={unit.uomName}
                  value={qtyOf(cart, unit.id)}
                  onChange={(qty) =>
                    qtyOf(cart, unit.id) === 0
                      ? dispatch({ type: 'add', line: addLine(product, unit), qty })
                      : dispatch({ type: 'setQty', productUnitId: unit.id, qty })
                  }
                />
              ) : null}
            </Card>
          ))}
          <Button
            title={t('mobile.tabs.cart')}
            variant="secondary"
            onPress={() => router.push('/cart')}
          />
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 44 },
  body: { padding: spacing.lg, gap: spacing.md },
  image: { width: '100%', height: 220, borderRadius: radii.card, backgroundColor: colors.card },
  unit: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, gap: 2 },
});
