import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { problemFrom } from '../../src/api/problem';
import { useRepHome } from '../../src/api/rep';
import { CategoryTile } from '../../src/customer/home-parts';
import { useSignedIn } from '../../src/state/session';
import { colors, spacing } from '../../src/theme/tokens';
import { ProblemText } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';
import { Card, PAGE } from '../../src/ui/staff-kit';
import { HeaderCart, StoreHeader } from '../../src/ui/store-header';

/**
 * «Бүх ангилал» in the rep app (ADR-0100 #9, as «Bto300»'s): every top category «Нүүр» knows, four
 * a row with their pictures in one white card; a tap opens the category's page. It reads the home already loaded.
 */
export default function RepCategoriesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const home = useRepHome();
  const categories = home.data?.categories ?? [];
  // Four tiles a row; the last row keeps its tiles at their place.
  const rows: ((typeof categories)[number] | null)[][] = [];
  for (let at = 0; at < categories.length; at += 4) {
    const row: ((typeof categories)[number] | null)[] = categories.slice(at, at + 4);
    while (row.length < 4) row.push(null);
    rows.push(row);
  }
  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.customer.categories.title')}
        onBack={() => router.back()}
        right={<HeaderCart />}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {home.error ? (
          <ProblemText problem={problemFrom(home.error)} style={styles.problem} />
        ) : null}
        {rows.length > 0 ? (
          <Card style={styles.grid}>
            {rows.map((row, index) => (
              <View key={index} style={styles.row}>
                {row.map((category, at) =>
                  category ? (
                    <CategoryTile
                      key={category.id}
                      category={category}
                      server={server}
                      onPress={() => router.push(`/category/${category.id}`)}
                    />
                  ) : (
                    <View key={`empty-${at}`} style={styles.grow} />
                  ),
                )}
              </View>
            ))}
          </Card>
        ) : home.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : null}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { ...PAGE, paddingBottom: 40 },
  problem: { marginTop: 0 },
  grid: { gap: 18, paddingHorizontal: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.xs },
  grow: { flex: 1 },
  loading: { marginTop: spacing.xxl },
});
