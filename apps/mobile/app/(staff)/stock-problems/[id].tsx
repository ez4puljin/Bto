import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { type StockProblemLine, useCountLine, useMySheets } from '../../../src/api/stock-problems';
import { HeaderSearch } from '../../../src/expiry/parts';
import { cleanQty } from '../../../src/expiry/rules';
import { formatQty } from '../../../src/format/format';
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Card } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** «+5», «−2», «0»: the difference of a counted line, the sign always shown. */
function signed(value: string): { text: string; sign: -1 | 0 | 1 } {
  const shown = formatQty(value);
  const sign = Number(value) > 0 ? 1 : Number(value) < 0 ? -1 : 0;
  return { text: sign > 0 ? `+${shown}` : shown, sign };
}

/**
 * One sheet (ADR-0230): the lines in shelf order, each with the system's quantity, how much was
 * red or cut, and a field for what is counted on the shelf. A line is saved by itself and may be
 * saved again until the office approves the sheet.
 */
export default function StockProblemSheetScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number.parseInt(params.id, 10);
  const sheets = useMySheets();
  const sheet = sheets.data?.find((one) => one.id === id) ?? null;
  const [search, setSearch] = useState('');

  const wanted = search.trim().toLocaleLowerCase();
  const lines = (sheet?.lines ?? []).filter(
    (line) =>
      wanted === '' ||
      line.product.name.toLocaleLowerCase().includes(wanted) ||
      line.product.sku.toLocaleLowerCase().includes(wanted) ||
      (line.binCode ?? '').toLocaleLowerCase().includes(wanted),
  );

  const header = (
    <StoreHeader
      title={sheet?.warehouseName ?? t('mobile.stockProblems.title')}
      subtitle={
        sheet
          ? t('mobile.stockProblems.counted', {
              done: sheet.countedCount,
              total: sheet.lineCount,
            })
          : null
      }
      onBack={() => router.back()}
    >
      {sheet ? (
        <HeaderSearch
          value={search}
          onChangeText={setSearch}
          placeholder={t('mobile.stockProblems.search')}
          label={t('mobile.stockProblems.search')}
        />
      ) : null}
    </StoreHeader>
  );

  return (
    <Page edges={[]}>
      {header}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
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
          ) : !sheet ? (
            <EmptyState title={t('mobile.stockProblems.gone')} />
          ) : lines.length === 0 ? (
            <EmptyState title={t('mobile.stockProblems.noResults')} />
          ) : (
            lines.map((line) => <LineCard key={line.id} line={line} />)
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

function LineCard({ line }: { line: StockProblemLine }) {
  const { t } = useTranslation();
  const toast = useToast();
  const count = useCountLine();
  const saved = line.countedQty;
  const [text, setText] = useState(saved ?? '');
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const typed = text === '' || text === '.' ? null : text;
  const changed = typed !== null && (saved === null || Number(typed) !== Number(saved));
  const hasRed = Number(line.redQty) > 0;
  const hasCut = Number(line.cutQty) > 0;
  const diff = line.difference !== null ? signed(line.difference) : null;

  const save = async () => {
    if (typed === null || count.isPending) return;
    setProblem(null);
    try {
      const answer = await count.mutateAsync({ key, lineId: line.id, countedQty: typed });
      setText(answer.countedQty ?? typed);
      // The next change of this line is a new save.
      setKey(Crypto.randomUUID());
      toast.show({ message: t('mobile.stockProblems.saved') });
    } catch (error) {
      const failed = problemFrom(error);
      setProblem(failed);
      if (failed.code === 'DOC_STATE_INVALID') setKey(Crypto.randomUUID());
    }
  };

  return (
    <Card style={styles.line}>
      <View style={styles.lineHead}>
        <View style={styles.grow}>
          <Text style={type.rowStrong} numberOfLines={3}>
            {line.product.name}
          </Text>
          <Text style={type.secondary} numberOfLines={1}>
            {[line.product.sku, line.binCode].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {saved !== null ? (
          <CircleCheck
            size={22}
            strokeWidth={2.2}
            color={colors.success}
            accessibilityLabel={t('mobile.stockProblems.countedTick')}
          />
        ) : null}
      </View>
      <View style={styles.facts}>
        <Fact label={t('mobile.stockProblems.system')} value={formatQty(line.systemQty)} />
        {hasRed ? (
          <Fact
            label={t('stockProblems.group.RED')}
            value={formatQty(line.redQty)}
            color={colors.destructive}
          />
        ) : null}
        {hasCut ? (
          <Fact
            label={t('stockProblems.group.CUT')}
            value={formatQty(line.cutQty)}
            color={colors.warning}
          />
        ) : null}
      </View>
      <TextField
        label={t('mobile.stockProblems.countedField', { unit: line.product.baseUomName })}
        value={text}
        onChangeText={(next) => {
          setText(cleanQty(next, true));
          setProblem(null);
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      {diff && !changed ? (
        <Text
          style={[
            type.rowStrong,
            tabular,
            {
              color:
                diff.sign > 0 ? colors.success : diff.sign < 0 ? colors.destructive : colors.muted,
            },
          ]}
        >
          {t('mobile.stockProblems.difference', { diff: diff.text.replace('-', '−') })}
        </Text>
      ) : null}
      {problem ? (
        problem.code === 'DOC_STATE_INVALID' ? (
          <Text style={[type.body, { color: colors.destructive }]} accessibilityRole="alert">
            {t('mobile.stockProblems.approved')}
          </Text>
        ) : (
          <ProblemText problem={problem} style={styles.flat} />
        )
      ) : null}
      {changed ? (
        <PillButton
          title={t('mobile.stockProblems.save')}
          loading={count.isPending}
          onPress={() => void save()}
        />
      ) : null}
    </Card>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.fact}>
      <Text style={[type.heading, tabular, color ? { color } : null]}>{value}</Text>
      <Text style={[type.caption, styles.factLabel]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  body: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  failed: { gap: spacing.md },
  flat: { marginTop: 0 },
  line: { gap: spacing.md },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  facts: { flexDirection: 'row', gap: 10 },
  fact: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  factLabel: { textAlign: 'center' },
});
