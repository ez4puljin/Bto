import { Plus, Printer } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { formatMnt } from '../format/format';
import { colors, spacing, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { Card } from '../ui/staff-kit';
import { Text } from '../ui/text';
import { CopiesStepper } from './copies-stepper';
import type { LabelProduct } from './list';

/**
 * The product a seller tapped: its name and code, the big «Зарах үнэ», the wholesale price when it
 * has one, the copies, and the two ways on: print this label now, or add it to the list.
 */
export function ProductCard({
  product,
  busy,
  onPrint,
  onAdd,
}: {
  product: LabelProduct;
  busy: boolean;
  onPrint: (copies: number) => void;
  onAdd: (copies: number) => void;
}) {
  const { t } = useTranslation();
  const [copies, setCopies] = useState(1);
  return (
    <Card style={styles.card}>
      <Text style={type.heading}>{product.name}</Text>
      <Text style={type.secondary}>{product.code}</Text>
      <View style={styles.priceBlock}>
        <Text style={type.secondary}>{t('mobile.labels.salePrice')}</Text>
        <Text style={styles.price}>{`${formatMnt(product.price)}₮`}</Text>
        {product.bulkQty !== null && product.bulkPrice !== null ? (
          <Text style={type.bodyStrong}>
            {t('mobile.labels.bulk', {
              qty: product.bulkQty,
              price: formatMnt(product.bulkPrice),
            })}
          </Text>
        ) : null}
      </View>
      <View style={styles.copies}>
        <Text style={type.rowStrong}>{t('mobile.labels.copies')}</Text>
        <CopiesStepper value={copies} onChange={setCopies} />
      </View>
      <PillButton
        title={t('mobile.labels.printOne')}
        icon={<Printer size={20} strokeWidth={2} color={colors.primaryForeground} />}
        loading={busy}
        onPress={() => onPrint(copies)}
      />
      <PillButton
        title={t('mobile.labels.addToList')}
        variant="soft"
        disabled={busy}
        icon={<Plus size={20} strokeWidth={2} color={colors.secondaryForeground} />}
        onPress={() => onAdd(copies)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  priceBlock: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.xs },
  price: { ...type.display, color: colors.foreground },
  copies: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
