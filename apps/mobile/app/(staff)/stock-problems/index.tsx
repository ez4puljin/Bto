import { useRouter } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import { useMySheets } from '../../../src/api/stock-problems';
import { ubDate } from '../../../src/dates/dates';
import { colors, spacing } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Pill } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';

/**
 * «Асуудалтай бараа» (ADR-0230): this morning's sheets of red and cut products, one for each of
 * the person's warehouses, with how many lines are counted. The office approves them on the web.
 */
export default function StockProblemsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sheets = useMySheets();
  const rows = sheets.data ?? [];

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.stockProblems.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={sheets.isRefetching}
            onRefresh={() => void sheets.refetch()}
          />
        }
      >
        {sheets.isPending ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : sheets.error ? (
          <View style={styles.failed}>
            <ProblemText problem={problemFrom(sheets.error)} />
            <PillButton
              title={t('common.retry')}
              variant="soft"
              onPress={() => void sheets.refetch()}
            />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={44} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.stockProblems.empty')}
          />
        ) : (
          <Group inset={ICON_INSET}>
            {rows.map((sheet) => (
              <Row
                key={sheet.id}
                icon={
                  <IconTile color={colors.tint.red}>
                    <ClipboardList size={20} strokeWidth={2} color={colors.primaryForeground} />
                  </IconTile>
                }
                title={sheet.warehouseName}
                subtitle={ubDate(sheet.sheetDate)}
                minHeight={56}
                right={
                  <Pill
                    label={t('mobile.stockProblems.counted', {
                      done: sheet.countedCount,
                      total: sheet.lineCount,
                    })}
                    tone={sheet.countedCount >= sheet.lineCount ? 'ok' : 'warn'}
                  />
                }
                onPress={() => router.push(`/stock-problems/${sheet.id}`)}
              />
            ))}
          </Group>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  loading: { marginTop: spacing.xl },
  failed: { gap: spacing.md },
});
