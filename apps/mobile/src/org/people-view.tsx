import { useRouter } from 'expo-router';
import { Gift, LayoutGrid, List, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { type Colleague, useDirectory } from '../api/directory';
import { problemFrom } from '../api/problem';
import { useDebounced } from '../state/use-debounced';
import { colors, radii, shadows, spacing, tabular, type } from '../theme/tokens';
import { PillButton, SearchField } from '../ui/controls';
import { Group } from '../ui/grouped';
import { EmptyState, ProblemText } from '../ui/kit';
import { PAGE } from '../ui/staff-kit';
import { useKeyboardShown, useStoreTabBarHeight } from '../ui/store-tab-bar';
import { Text } from '../ui/text';
import { ColleagueCard, ColleagueRow } from './colleague';

type Layout = 'grid' | 'list';

/** Room under the list for the floating «Талархал илгээх». */
const FLOATING = 48 + spacing.lg * 2;

/** Pairs for the two-a-row grid; an odd last card keeps half the width. */
function pairsOf(people: readonly Colleague[]): [Colleague, Colleague | null][] {
  const pairs: [Colleague, Colleague | null][] = [];
  for (let index = 0; index < people.length; index += 2) {
    const first = people[index];
    if (first) pairs.push([first, people[index + 1] ?? null]);
  }
  return pairs;
}

/**
 * «Байгууллага» → «Манайхан»: the search over name, division, mail and number, how many are shown
 * with the grid / list switch, the colleagues as cards two a row or as rows, and the floating
 * «Талархал илгээх», which opens «Талархал».
 */
export function PeopleView() {
  const { t } = useTranslation();
  const router = useRouter();
  const barHeight = useStoreTabBarHeight();
  const keyboard = useKeyboardShown();
  const [text, setText] = useState('');
  const [layout, setLayout] = useState<Layout>('grid');
  const q = useDebounced(text.trim(), 300);
  const directory = useDirectory(q);
  const people = directory.data ?? [];

  const layouts: { value: Layout; label: string; Icon: typeof LayoutGrid }[] = [
    { value: 'grid', label: t('mobile.org.people.grid'), Icon: LayoutGrid },
    { value: 'list', label: t('mobile.org.people.list'), Icon: List },
  ];

  const body = () => {
    if (directory.isLoading)
      return <ActivityIndicator style={styles.loading} color={colors.primary} />;
    if (directory.error && !directory.data) {
      return <ProblemText problem={problemFrom(directory.error)} />;
    }
    if (people.length === 0) {
      return (
        <EmptyState
          icon={<UsersRound size={40} strokeWidth={1.5} color={colors.muted} />}
          title={t('mobile.org.people.empty')}
          hint={q === '' ? undefined : t('mobile.org.people.emptyHint')}
        />
      );
    }
    if (layout === 'list') {
      return (
        <Group inset={spacing.lg + 46 + spacing.md}>
          {people.map((person) => (
            <ColleagueRow key={person.userId} person={person} />
          ))}
        </Group>
      );
    }
    return (
      <View style={styles.grid}>
        {pairsOf(people).map(([first, second]) => (
          <View key={first.userId} style={styles.pair}>
            <ColleagueCard person={first} />
            {second ? <ColleagueCard person={second} /> : <View style={styles.filler} />}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.flex}>
      <View style={styles.top}>
        <SearchField
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.org.people.search')}
          accessibilityLabel={t('mobile.org.people.search')}
          autoCapitalize="none"
          style={styles.search}
        />
        <View style={styles.countRow}>
          <Text style={[type.secondary, tabular, styles.grow]} numberOfLines={1}>
            {directory.data ? t('mobile.org.people.total', { n: people.length }) : ''}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('mobile.org.people.layout')}
            style={styles.switch}
          >
            {layouts.map(({ value, label, Icon }) => {
              const on = layout === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: on }}
                  onPress={() => setLayout(value)}
                  hitSlop={{ top: 6, bottom: 6 }}
                  style={[styles.switchButton, on && styles.switchOn]}
                >
                  <Icon size={18} strokeWidth={2} color={on ? colors.primary : colors.muted} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.body, { paddingBottom: barHeight + FLOATING }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={directory.isRefetching && !directory.isPlaceholderData}
            onRefresh={() => void directory.refetch()}
          />
        }
      >
        {body()}
      </ScrollView>
      {keyboard ? null : (
        <View
          pointerEvents="box-none"
          style={[styles.floating, { bottom: barHeight + spacing.lg }]}
        >
          <PillButton
            height={48}
            icon={<Gift size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
            title={t('mobile.org.people.thanks')}
            onPress={() => router.push('/community/thanks')}
            style={styles.floatingButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  loading: { marginTop: spacing.xl },
  top: {
    paddingHorizontal: PAGE.padding,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  search: { backgroundColor: colors.card, boxShadow: shadows.card },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  switch: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: radii.control,
    backgroundColor: colors.fieldFill,
  },
  switchButton: {
    width: 40,
    height: 32,
    borderRadius: radii.control - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.card, boxShadow: shadows.segment },
  body: { paddingHorizontal: PAGE.padding, paddingTop: spacing.xs },
  grid: { gap: spacing.md },
  pair: { flexDirection: 'row', gap: spacing.md },
  filler: { flex: 1 },
  floating: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  floatingButton: { paddingHorizontal: spacing.xl, boxShadow: shadows.brand },
});
