import { Image } from 'expo-image';
import { ChevronLeft, Package } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RepProduct } from '../api/rep';
import { formatMnt, formatQty } from '../format/format';
import { colors, fonts, radii, shadows, spacing, type } from '../theme/tokens';
import { Segmented } from '../ui/controls';
import { Keypad } from '../ui/keypad';
import { useUnitOptions } from './unit-options';
import { useUnitWords } from './unit-words';
import { baseQty, baseUnitOf, shortBy } from './units';
import { useLineQuote } from './use-line-quote';

/** At most four digits, as the design's keypad takes them. */
const MAX_DIGITS = 4;

/**
 * «Тоо оруулах» (the ProductKeypad board, ADR-0066): the product, the unit switch, the number typed
 * in a large box with what it comes to (pieces and the server's total), the shortage, and the
 * keypad. «Болсон» hands the unit and the number back; «Цуцлах» and the back button drop them.
 */
export function QtyKeypad({
  visible,
  product,
  server,
  unitId,
  qty,
  onDone,
  onCancel,
}: {
  visible: boolean;
  product: RepProduct;
  server: string;
  unitId: number;
  qty: number;
  onDone: (unitId: number, qty: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const unitOptions = useUnitOptions();
  const [unit, setUnit] = useState(unitId);
  const [digits, setDigits] = useState(String(qty));
  useEffect(() => {
    if (!visible) return;
    setUnit(unitId);
    setDigits(qty > 0 ? String(qty) : '');
  }, [visible, unitId, qty]);

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

  const value = digits === '' ? 0 : Number.parseInt(digits, 10);
  const chosen = product.units.find((entry) => entry.id === unit) ?? product.units[0];
  const base = baseUnitOf(product.units);
  const quote = useLineQuote(product.units, chosen?.id ?? null, value);
  if (!chosen || !base) return null;
  const pieces = baseQty(value, chosen);
  const short = shortBy(pieces, product.available);
  const conversion = [
    chosen.isBase
      ? null
      : t('mobile.product.equals', { n: pieces.toFixed(), unit: words(base).name }),
    quote.total ? t('mobile.product.totalIs', { amount: formatMnt(quote.total) }) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
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
              />
            ) : (
              <Package size={28} strokeWidth={1.5} color={colors.input} />
            )}
          </View>
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={type.secondary}>
              {t('mobile.keypad.codeStock', {
                sku: product.sku,
                n: formatQty(product.available),
                unit: words(base).name,
              })}
            </Text>
            {chosen.wholesale ? (
              <Text style={type.bodyStrong}>
                {t('mobile.product.pricePer', {
                  amount: formatMnt(chosen.wholesale),
                  unit: words(chosen).name,
                })}
              </Text>
            ) : null}
          </View>
        </View>
        {product.units.length > 1 ? (
          <View style={styles.units}>
            <Segmented
              options={unitOptions(product.units)}
              value={String(unit)}
              onChange={(next) => setUnit(Number.parseInt(next, 10))}
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
            <Text style={styles.unitWord}>{words(chosen).name}</Text>
          </View>
          {conversion ? <Text style={styles.conversion}>{conversion}</Text> : null}
        </View>
        {short.gt(0) ? (
          <Text style={styles.short}>
            {t('mobile.keypad.short', {
              stock: formatQty(product.available),
              short: short.toFixed(),
              unit: words(base).name,
            })}
          </Text>
        ) : null}
        <View style={styles.grow} />
        <Keypad
          onDigit={(digit) =>
            setDigits((current) => {
              const next = (current === '0' ? '' : current) + digit;
              return next.length <= MAX_DIGITS ? next : current;
            })
          }
          onDelete={() => setDigits((current) => current.slice(0, -1))}
          onCancel={onCancel}
          onDone={() => onDone(unit, value)}
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
  name: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24, color: colors.foreground },
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
  number: {
    fontFamily: fonts.bold,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1,
    color: colors.foreground,
    fontVariant: ['tabular-nums'],
  },
  caret: { width: 3, height: 40, borderRadius: 2, backgroundColor: colors.primary },
  unitWord: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26, color: colors.muted },
  conversion: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.label2 },
  short: {
    marginTop: 10,
    marginHorizontal: 20,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
});
