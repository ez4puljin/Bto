import { useRouter } from 'expo-router';
import { ClipboardCheck, ClipboardList } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type OpenStockCount, useOpenCounts } from '../../../src/api/counts';
import { problemFrom } from '../../../src/api/problem';
import { colors, spacing } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { FootNote, Page, SectionHeader } from '../../../src/ui/layout';
import { Pill } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';

/**
 * «Тооллого» (ADR-0176 #4): the counts being counted now in two grouped lists — the ones this
 * person still counts (or has not begun), then the ones they sent — each with their own state in
 * it («Тоолж байна» until they send). A count is made on the web; here it is only counted.
 */
export default function CountsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const counts = useOpenCounts();
  const rows = counts.data ?? [];

  const counting = rows.filter((count) => count.mine !== 'SENT');
  const sent = rows.filter((count) => count.mine === 'SENT');

  const row = (count: OpenStockCount) => (
    <Row
      key={count.id}
      icon={
        count.mine === 'SENT' ? (
          <IconTile color={colors.successSoft}>
            <ClipboardCheck size={20} strokeWidth={2} color={colors.success} />
          </IconTile>
        ) : (
          <IconTile color={colors.tint.purple}>
            <ClipboardList size={20} strokeWidth={2} color={colors.primaryForeground} />
          </IconTile>
        )
      }
      title={count.warehouseName}
      subtitle={[count.scopeLabel, count.note].filter(Boolean).join(' · ')}
      minHeight={56}
      right={
        count.mine === 'OPEN' ? (
          <Pill label={t('mobile.counts.mine.OPEN')} tone="warn" />
        ) : count.mine === 'SENT' ? (
          <Pill label={t('mobile.counts.mine.SENT')} tone="ok" />
        ) : null
      }
      onPress={() => router.push(`/counts/${count.id}`)}
    />
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.counts.title')} onBack={() => router.back()} />
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
          <>
            {counting.length > 0 ? (
              <View>
                <SectionHeader style={styles.head}>
                  {t('mobile.counts.sections.counting')}
                </SectionHeader>
                <Group inset={ICON_INSET}>{counting.map(row)}</Group>
              </View>
            ) : null}
            {sent.length > 0 ? (
              <View>
                <SectionHeader style={styles.head}>{t('mobile.counts.mine.SENT')}</SectionHeader>
                <Group inset={ICON_INSET}>{sent.map(row)}</Group>
              </View>
            ) : null}
            <FootNote center>{t('mobile.counts.emptyHint')}</FootNote>
          </>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  head: { marginTop: 0 },
  loading: { marginTop: spacing.xl },
  failed: { gap: spacing.md },
});
