import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft, Package } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatMnt } from '../format/format';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../theme/tokens';
import { PillButton, Segmented } from '../ui/controls';
import { Keypad } from '../ui/keypad';
import { Text } from '../ui/text';
import { useUnitOptions } from './unit-options';
import { useUnitWords } from './unit-words';
import type { UnitLike } from './units';

/** At most four digits, as the design's keypad takes them. */
export const MAX_DIGITS = 4;

export interface KeypadUnit extends UnitLike {
  /** One unit at the wholesale price; null without one. */
  wholesale: string | null;
}

export interface KeypadProduct {
  name: string;
  sku: string;
  thumbUrl: string | null;
  units: readonly KeypadUnit[];
}

/**
 * «Тоо оруулах» as the ProductKeypad board draws it (ADR-0068), for either app: the product with a
 * line under its name, the unit switch, the number typed in a large box with what it comes to, a
 * note under it, and the keypad. The app's wrapper keeps the unit and the digits and says what the
 * number comes to (src/shop/qty-keypad.tsx for the rep, src/customer/qty-keypad.tsx for «Bto300»).
 */
export function KeypadSheet({
  visible,
  product,
  server,
  subtitle,
  unit,
  digits,
  onUnit,
  onDigits,
  conversion,
  note,
  extra,
  onDone,
  onCancel,
}: {
  visible: boolean;
  product: KeypadProduct;
  server: string;
  /** Under the name: the code and the stock (a number for a rep, a word for a store). */
  subtitle: string;
  unit: KeypadUnit;
  digits: string;
  onUnit: (unitId: number) => void;
  onDigits: (update: (current: string) => string) => void;
  /** «= 24 ширхэг · 16,800₮» in the box; empty for nothing. */
  conversion: string;
  /** A warning under the box (a shortage, «Зарим нь хойшилж магадгүй»); null for none. */
  note: string | null;
  /** A second answer above the keys («Ирээгүй» when receiving a transfer, ADR-0116 #4). */
  extra?: { label: string; onPress: () => void };
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const unitOptions = useUnitOptions();

  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, blink]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      {/* Dark icons on the white keypad: under the apps' blue headers the bar is white. */}
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.page}>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onCancel}
            style={styles.back}
          >
            <ChevronLeft size={24} strokeWidth={2.4} color={colors.foreground} />
          </Pressable>
          <Text style={type.heading}>{t('mobile.keypad.title')}</Text>
          <View style={styles.spacer} />
        </View>
        <View style={styles.product}>
          <View style={styles.thumb}>
            {product.thumbUrl ? (
              <Image
                source={{ uri: `${server}${product.thumbUrl}` }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={product.thumbUrl}
              />
            ) : (
              <Package size={28} strokeWidth={1.5} color={colors.input} />
            )}
          </View>
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={type.secondary}>{subtitle}</Text>
            {unit.wholesale ? (
              <Text style={type.bodyStrong}>
                {t('mobile.product.pricePer', {
                  amount: formatMnt(unit.wholesale),
                  unit: words(unit).name,
                })}
              </Text>
            ) : null}
          </View>
        </View>
        {product.units.length > 1 ? (
          <View style={styles.units}>
            <Segmented
              options={unitOptions(product.units)}
              value={String(unit.id)}
              onChange={(next) => onUnit(Number.parseInt(next, 10))}
              label={t('mobile.product.unit')}
            />
          </View>
        ) : null}
        <View
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={t('mobile.keypad.typed')}
          style={styles.display}
        >
          <View style={styles.typed}>
            <Text style={styles.number}>{digits === '' ? '0' : digits}</Text>
            <Animated.View style={[styles.caret, { opacity: blink }]} />
            <Text style={styles.unitWord}>{words(unit).name}</Text>
          </View>
          {conversion ? <Text style={styles.conversion}>{conversion}</Text> : null}
        </View>
        {note ? <Text style={styles.short}>{note}</Text> : null}
        <View style={styles.grow} />
        {extra ? (
          <View style={styles.extra}>
            <PillButton
              title={extra.label}
              variant="destructive"
              height={44}
              onPress={extra.onPress}
            />
          </View>
        ) : null}
        <Keypad
          onDigit={(digit) =>
            onDigits((current) => {
              const next = (current === '0' ? '' : current) + digit;
              return next.length <= MAX_DIGITS ? next : current;
            })
          }
          onDelete={() => onDigits((current) => current.slice(0, -1))}
          onCancel={onCancel}
          onDone={onDone}
          cancelLabel={t('mobile.keypad.cancel')}
          doneLabel={t('mobile.keypad.done')}
          deleteLabel={t('mobile.keypad.delete')}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.card },
  head: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineSoft,
    boxShadow: shadows.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { width: 44 },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radii.card,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  grow: { flex: 1, gap: 2 },
  name: type.title3,
  units: { marginTop: 22, marginHorizontal: 20 },
  display: {
    marginTop: spacing.lg,
    marginHorizontal: 20,
    minHeight: 96,
    borderRadius: radii.tile,
    backgroundColor: colors.imageFill,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
  },
  typed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  number: { ...type.hero, ...tabular },
  caret: { width: 3, height: 40, borderRadius: 2, backgroundColor: colors.primary },
  unitWord: { ...type.title3, fontFamily: fonts.regular, color: colors.muted },
  conversion: { ...type.row, color: colors.label2 },
  extra: { marginHorizontal: 20, marginBottom: spacing.md },
  short: {
    ...type.chip,
    marginTop: 10,
    marginHorizontal: 20,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
  },
});
