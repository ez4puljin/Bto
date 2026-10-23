import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { problemFrom } from '../../src/api/problem';
import { useRepHome } from '../../src/api/rep';
import { CategoryTile } from '../../src/customer/home-parts';
import { useSignedIn } from '../../src/state/session';
import { colors, spacing } from '../../src/theme/tokens';
import { ProblemText } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';
import { StoreHeader } from '../../src/ui/store-header';

/**
 * «Бүх ангилал» in the rep app (ADR-0100 #9, as «Bto300»'s): every top category «Нүүр» knows, four
 * a row with their pictures; a tap opens the category's page. It reads the home already loaded.
 */
export default function RepCategoriesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const home = useRepHome();
  const { width } = useWindowDimensions();
  const cell = (width - spacing.md * 2 - spacing.sm * 3) / 4;
  const categories = home.data?.categories ?? [];
  return (
    <Page white edges={[]}>
      <StoreHeader title={t('mobile.customer.categories.title')} onBack={() => router.back()} />
      <FlatList
        data={categories}
        numColumns={4}
        keyExtractor={(category) => String(category.id)}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.head}>
            {home.error ? <ProblemText problem={problemFrom(home.error)} /> : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        renderItem={({ item }) => (
          <View style={{ width: cell }}>
            <CategoryTile
              category={item}
              server={server}
              onPress={() => router.push(`/category/${item.id}`)}
            />
          </View>
        )}
        ListEmptyComponent={
          home.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, paddingBottom: 40 },
  head: { paddingTop: spacing.lg, paddingHorizontal: spacing.xs },
  row: { gap: spacing.sm },
  rowGap: { height: 14 },
  loading: { marginTop: spacing.xxl },
});
