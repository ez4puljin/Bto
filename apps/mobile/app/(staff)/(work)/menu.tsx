import { Search, Star, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { type MenuItem, type MenuKey, quickStripOf } from '../../../src/staff/menu';
import {
  MENU_LOOK,
  searchedMenu,
  useFavourites,
  useStaffMenu,
} from '../../../src/staff/menu-parts';
import { colors, radii, spacing, storeType, TOUCH, type } from '../../../src/theme/tokens';
import { CountBadge } from '../../../src/ui/controls';
import { Group, ICON_INSET, ICON_TILE, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { PAGE } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text, TextInput } from '../../../src/ui/text';

/**
 * «Цэс» (ADR-0174): every screen this person may open, grouped by work area. Favourites are
 * repeated here as quick launch tiles, so a frequently used task is available without scrolling
 * through every group. Search narrows the full menu and temporarily gets the screen to itself.
 */
export default function MenuScreen() {
  const { t } = useTranslation();
  const inset = useStoreTabBarInset();
  const { groups, countOf, open } = useStaffMenu();
  const { favourites, isFavourite, toggle } = useFavourites(groups);
  const [search, setSearch] = useState('');
  const searching = search.trim().length > 0;
  const quick = quickStripOf(favourites, search);
  const shown = useMemo(
    () => searchedMenu(groups, (key: MenuKey) => t(`mobile.staffMenu.items.${key}`), search),
    [groups, search, t],
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.menu')} right={null}>
        <View style={styles.searchPad}>
          <View style={styles.search}>
            <Search size={18} strokeWidth={2.2} color={colors.placeholder} />
            <TextInput
              accessibilityLabel={t('mobile.staffMenu.search')}
              placeholder={t('mobile.staffMenu.search')}
              placeholderTextColor={colors.placeholder}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[storeType.search, styles.searchInput]}
            />
            {search !== '' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.clear')}
                onPress={() => setSearch('')}
                hitSlop={4}
                style={styles.clear}
              >
                <X size={16} strokeWidth={2.4} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </StoreHeader>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {quick.length > 0 ? (
          <View style={styles.block}>
            <SectionHeader style={styles.label}>{t('mobile.staffHome.favourites')}</SectionHeader>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.quickRow}
            >
              {quick.map((item: MenuItem) => {
                const { Icon, color } = MENU_LOOK[item.key];
                const title = t(`mobile.staffMenu.items.${item.key}`);
                const count = countOf(item.key);
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityLabel={count > 0 ? `${title}, ${count}` : title}
                    onPress={() => open(item)}
                    style={({ pressed }) => [styles.quickCard, pressed && styles.quickCardPressed]}
                  >
                    <View style={styles.quickIcon}>
                      <IconTile color={color}>
                        <Icon size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                      </IconTile>
                      <CountBadge count={count} ring={colors.card} style={styles.quickBadge} />
                    </View>
                    <Text style={styles.quickTitle} numberOfLines={2}>
                      {title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {shown.length === 0 ? (
          <EmptyState
            icon={<Search size={36} strokeWidth={1.6} color={colors.muted} />}
            title={t('common.noMatches')}
            hint={t('mobile.staffMenu.noMatchHint')}
          />
        ) : null}
        {shown.map((group, at) => (
          <View key={group.key} style={styles.block}>
            <SectionHeader
              style={styles.label}
              right={
                at === 0 && !searching ? (
                  <Text style={type.secondary} numberOfLines={1}>
                    {t('mobile.staffMenu.starHint')}
                  </Text>
                ) : undefined
              }
            >
              {t(`mobile.staffMenu.groups.${group.key}`)}
            </SectionHeader>
            <Group inset={ICON_INSET}>
              {group.items.map((item) => {
                const { Icon, color } = MENU_LOOK[item.key];
                const title = t(`mobile.staffMenu.items.${item.key}`);
                const on = isFavourite(item.key);
                return (
                  <Row
                    key={item.key}
                    icon={
                      <IconTile color={color}>
                        <Icon size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                      </IconTile>
                    }
                    title={title}
                    right={
                      <>
                        <CountBadge count={countOf(item.key)} ring={colors.card} />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(
                            on ? 'mobile.staffMenu.unfavourite' : 'mobile.staffMenu.favourite',
                            { title },
                          )}
                          accessibilityState={{ selected: on }}
                          hitSlop={4}
                          onPress={() => toggle(item.key)}
                          style={styles.star}
                        >
                          <Star
                            size={20}
                            strokeWidth={2}
                            color={on ? colors.tint.amber : colors.input}
                            fill={on ? colors.tint.amber : 'transparent'}
                          />
                        </Pressable>
                      </>
                    }
                    onPress={() => open(item)}
                  />
                );
              })}
            </Group>
          </View>
        ))}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: PAGE,
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  searchPad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  search: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, paddingVertical: 0, color: colors.foreground },
  clear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  quickRow: { gap: spacing.sm, paddingRight: PAGE.padding },
  quickCard: {
    width: 112,
    minHeight: 104,
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  quickCardPressed: { backgroundColor: colors.accent },
  quickIcon: { width: ICON_TILE, height: ICON_TILE, position: 'relative' },
  quickBadge: { position: 'absolute', top: -6, right: -6 },
  quickTitle: { ...type.chip, color: colors.foreground },
  star: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
