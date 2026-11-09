import { useRouter } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type OpenStockCount, useOpenCounts } from '../../../src/api/counts';
import { problemFrom } from '../../../src/api/problem';
import { StatusPill } from '../../../src/community/parts';
import { colors, spacing, TOUCH } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';

/**
 * «Тооллого» (ADR-0176 #4): the counts being counted now, each with this person's own state in it
 * («Тоолж байна» until they send). A count is made on the web; here it is only counted.
 */
export default function CountsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const counts = useOpenCounts();
  const rows = counts.data ?? [];

  const pill = (count: OpenStockCount) =>
    count.mine === 'OPEN' ? (
      <StatusPill
        label={t('mobile.counts.mine.OPEN')}
        background={colors.warningSoft}
        color={colors.warningText}
      />
    ) : count.mine === 'SENT' ? (
      <StatusPill
        label={t('mobile.counts.mine.SENT')}
        background={colors.successSoft}
        color={colors.success}
      />
    ) : null;

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.counts.title')} onBack={() => router.back()} right={null} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={counts.isRefetching}
            onRefresh={() => void counts.refetch()}
          />
        }
      >
        {counts.isPending ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : counts.error ? (
          <View style={styles.failed}>
            <ProblemText problem={problemFrom(counts.error)} />
            <PillButton
              title={t('common.retry')}
              variant="soft"
              onPress={() => void counts.refetch()}
            />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={44} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.counts.empty')}
            hint={t('mobile.counts.emptyHint')}
          />
        ) : (
          <Group>
            {rows.map((count) => (
              <Row
                key={count.id}
                title={count.warehouseName}
                subtitle={[count.scopeLabel, count.note].filter(Boolean).join(' · ')}
                minHeight={TOUCH + spacing.md}
                right={pill(count)}
                onPress={() => router.push(`/counts/${count.id}`)}
              />
            ))}
          </Group>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: 14, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  failed: { gap: spacing.md },
});
