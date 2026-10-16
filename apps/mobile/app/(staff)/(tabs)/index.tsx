import { useRouter } from 'expo-router';
import { ClipboardList, MapPin, ShoppingCart, Store } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOrders, useRepContext } from '../../../src/api/rep';
import { monthOf } from '../../../src/dates/dates';
import { effectiveStage, placeOf } from '../../../src/state/placement';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { Button, Card, Money, Screen, SectionTitle, Title } from '../../../src/ui/kit';

/** «Нүүр»: the month so far, where new orders land, and the way into the shop. */
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me } = useSignedIn();
  const { cart, stageId, setStageId, ready } = useShop();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const orders = useOrders(today ? monthOf(today) : '');
  const summary = orders.data?.pages[0]?.summary ?? null;

  // A stage the rep may no longer use is dropped; the default (or the only one) is taken.
  useEffect(() => {
    if (!ready || !context.data) return;
    const next = effectiveStage(context.data, stageId);
    if (next !== stageId) setStageId(next);
  }, [ready, context.data, stageId, setStageId]);

  const place = context.data ? placeOf(context.data, stageId) : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={context.isRefetching || orders.isRefetching}
            onRefresh={() => {
              void context.refetch();
              void orders.refetch();
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text style={type.secondary}>{today ?? ''}</Text>
          <Title>{t('mobile.home.hello', { name: me.fullName })}</Title>
        </View>

        <Card>
          <SectionTitle>{t('mobile.home.month')}</SectionTitle>
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={type.title}>{String(summary?.count ?? 0)}</Text>
              <Text style={type.caption}>{t('mobile.home.orders')}</Text>
            </View>
            <View style={styles.stat}>
              <Money value={summary?.total ?? '0'} style={type.heading} />
              <Text style={type.caption}>{t('mobile.home.total')}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={type.title}>{String(summary?.drafts ?? 0)}</Text>
              <Text style={type.caption}>{t('mobile.home.drafts')}</Text>
            </View>
          </View>
        </Card>

        <Card>
          <View style={styles.row}>
            <MapPin size={20} color={place ? colors.primary : colors.warning} />
            <View style={styles.grow}>
              <Text style={type.caption}>{t('mobile.home.landsOn')}</Text>
              <Text style={type.bodyStrong}>
                {place
                  ? `${place.pipelineName} › ${place.stageName}`
                  : t('mobile.settings.notChosen')}
              </Text>
              {place ? (
                <Text style={type.secondary}>
                  {t(place.confirms ? 'mobile.settings.confirms' : 'mobile.settings.drafts')}
                </Text>
              ) : null}
            </View>
          </View>
          <Button
            variant="secondary"
            title={t('mobile.settings.title')}
            onPress={() => router.push('/settings')}
          />
        </Card>

        <View style={styles.actions}>
          <Button
            title={t('mobile.home.openShop')}
            icon={<Store size={18} color={colors.primaryForeground} />}
            onPress={() => router.push('/shop')}
          />
          <Button
            variant="secondary"
            title={t('mobile.home.openCart', { n: cart.lines.length })}
            icon={<ShoppingCart size={18} color={colors.secondaryForeground} />}
            onPress={() => router.push('/cart')}
          />
          <Button
            variant="secondary"
            title={t('mobile.home.openOrders')}
            icon={<ClipboardList size={18} color={colors.secondaryForeground} />}
            onPress={() => router.push('/orders')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.lg },
  header: { gap: spacing.xs },
  stats: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  stat: { flex: 1, gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  grow: { flex: 1, gap: 2 },
  actions: { gap: spacing.sm },
});
