import { Search, Star, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { MenuKey } from '../../../src/staff/menu';
import {
  MENU_LOOK,
  searchedMenu,
  useFavourites,
  useStaffMenu,
} from '../../../src/staff/menu-parts';
import { colors, radii, spacing, storeType, TOUCH, type } from '../../../src/theme/tokens';
import { CountBadge } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { PAGE } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text, TextInput } from '../../../src/ui/text';

/**
 * «Цэс» (ADR-0174): every screen of the app this person's rights open, in groups under their
 * labels. A rep finds «ХТ захиалга», which opens the order tabs; a star puts a row on «Нүүр»; the
 * field on the header narrows the rows by name, on the phone alone.
 */
export default function MenuScreen() {
  const { t } = useTranslation();
  const inset = useStoreTabBarInset();
  const { groups, countOf, open } = useStaffMenu();
  const { isFavourite, toggle } = useFavourites(groups);
  const [search, setSearch] = useState('');
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
                hitSlop={8}
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
        keyboardShouldPersistTaps="handled"
      >
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
                at === 0 && search.trim() === '' ? (
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
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radii.field,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, paddingVertical: 0, color: colors.foreground },
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  star: { width: 36, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
