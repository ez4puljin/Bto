import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import type { AppProblem } from '../api/problem';
import { colors, radii, spacing, type } from '../theme/tokens';
import { SearchField } from '../ui/controls';
import { Row, Separator } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { BackLink } from '../ui/layout';
import { Sheet, SheetHeader } from '../ui/sheet';
import { Text } from '../ui/text';

export interface PickOption {
  id: number;
  title: string;
  subtitle?: string | null;
}

/**
 * A list to choose one thing from (a category, a supplier, a warehouse), with a search over it.
 * Without `onSearch` the sheet filters the options it was given; with it the caller searches (the
 * suppliers, on the server) and gives the answer back as `options`.
 */
export function PickSheet({
  visible,
  title,
  searchLabel,
  options,
  selectedId,
  loading = false,
  problem,
  emptyText,
  onSearch,
  onPick,
  onClose,
  footer,
}: {
  visible: boolean;
  title: string;
  searchLabel: string;
  options: readonly PickOption[];
  selectedId: number | null;
  loading?: boolean;
  problem?: AppProblem | null;
  emptyText: string;
  onSearch?: (q: string) => void;
  onPick: (option: PickOption) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    if (onSearch) return options;
    const needle = q.trim().toLowerCase();
    return needle === ''
      ? options
      : options.filter((option) => option.title.toLowerCase().includes(needle));
  }, [options, q, onSearch]);

  const change = (text: string) => {
    setQ(text);
    onSearch?.(text.trim());
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={12}
      footer={footer}
      header={
        <SheetHeader
          left={<BackLink label={t('common.back')} onPress={onClose} />}
          title={title}
          right={null}
        />
      }
    >
      <View style={styles.search}>
        <SearchField
          value={q}
          onChangeText={change}
          placeholder={searchLabel}
          accessibilityLabel={searchLabel}
        />
      </View>
      {problem ? <ProblemText problem={problem} style={styles.problem} /> : null}
      <FlatList
        data={rows}
        keyExtractor={(option) => String(option.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cell,
              index === 0 && styles.firstCell,
              index === rows.length - 1 && styles.lastCell,
            ]}
          >
            {index > 0 ? <Separator /> : null}
            <Row
              title={item.title}
              subtitle={item.subtitle}
              role="radio"
              checked={item.id === selectedId}
              chevron={false}
              minHeight={52}
              onPress={() => onPick(item)}
            />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : (
            <Text style={[type.body, styles.empty]}>{emptyText}</Text>
          )
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md },
  problem: { marginHorizontal: spacing.lg, marginTop: 0, marginBottom: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  cell: { backgroundColor: colors.card },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  empty: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted },
  loading: { marginTop: spacing.xl },
});
