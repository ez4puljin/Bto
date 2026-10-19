import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';
import { Group, Row } from '../ui/grouped';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { type MapStore, stateOf, type StoreState } from './stores';

/** A store's dot, the colour of its pin: black when its orders are closed, red or green. */
const DOT_COLORS: Record<StoreState, string> = {
  blocked: colors.blocked,
  stale: colors.tint.red,
  fresh: colors.tint.green,
};

/** A row of the list: the store's name over its code. */
const ROW_HEIGHT = 58;
/** The grabber and the header above the rows. */
const CHROME = 62;

/** How tall the list is drawn for `count` stores: six and a half rows at most, then it scrolls. */
function pickerHeight(count: number, insetBottom: number): number {
  const rows = Math.min(Math.max(count, 1), 6.5);
  return CHROME + spacing.xs + rows * ROW_HEIGHT + spacing.lg + insetBottom;
}

/**
 * Several stores at (about) one point (the owner, 2026-10-18): their pins lie on each other, so the
 * rep picks the one they mean from a list, which then opens its card.
 */
export function StorePicker({
  stores: picked,
  onPick,
  onClose,
}: {
  /** null when closed; otherwise the stores, in the list's order. */
  stores: MapStore[] | null;
  onPick: (customerId: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // The last list stays drawn while the sheet slides away.
  const [shown, setShown] = useState(picked);
  if (picked !== null && picked !== shown) setShown(picked);
  const stores = picked ?? shown ?? [];
  const insetBottom = insets.bottom;
  const top = Math.max(62, height - insets.top - pickerHeight(stores.length, insetBottom));

  return (
    <Sheet
      visible={picked !== null}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={top}
      header={
        <SheetHeader
          title={t('mobile.map.pickStore', { n: stores.length })}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
    >
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insetBottom + spacing.lg }]}
      >
        <Group inset={spacing.lg + 10 + spacing.md}>
          {stores.map((store) => (
            <Row
              key={store.customerId}
              icon={<View style={[styles.dot, { backgroundColor: DOT_COLORS[stateOf(store)] }]} />}
              title={store.name}
              subtitle={t('mobile.map.code', { code: store.code })}
              minHeight={ROW_HEIGHT}
              onPress={() => onPick(store.customerId)}
              accessibilityLabel={store.name}
            />
          ))}
        </Group>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
