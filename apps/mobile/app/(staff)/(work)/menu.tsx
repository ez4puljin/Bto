import { Star } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { MENU_LOOK, useFavourites, useStaffMenu } from '../../../src/staff/menu-parts';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { CountBadge } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text } from '../../../src/ui/text';

/**
 * «Цэс» (ADR-0174): every screen of the app this person's rights open, in groups. A rep finds
 * «ХТ захиалга», which opens the order tabs; a star puts a row on «Нүүр».
 */
export default function MenuScreen() {
  const { t } = useTranslation();
  const inset = useStoreTabBarInset();
  const { groups, countOf, open } = useStaffMenu();
  const { isFavourite, toggle } = useFavourites(groups);

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.menu')} right={null} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}>
        {groups.map((group) => (
          <Group key={group.key} inset={ICON_INSET} style={styles.group}>
            <Text accessibilityRole="header" style={[type.sectionHeader, styles.heading]}>
              {t(`mobile.staffMenu.groups.${group.key}`)}
            </Text>
            {group.items.map((item) => {
              const { Icon, color } = MENU_LOOK[item.key];
              const title = t(`mobile.staffMenu.items.${item.key}`);
              const on = isFavourite(item.key);
              return (
                <Row
                  key={item.key}
                  minHeight={52}
                  icon={
                    <IconTile color={color}>
                      <Icon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
                    </IconTile>
                  }
                  title={title}
                  chevron={false}
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
                        hitSlop={10}
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
        ))}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 14, paddingTop: spacing.md, gap: spacing.md },
  group: {},
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  star: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
