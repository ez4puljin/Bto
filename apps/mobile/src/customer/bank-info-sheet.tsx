import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type StoreBankAccount, useBankAccounts } from '../api/customer';
import { problemFrom } from '../api/problem';
import { colors, fonts, radii, spacing, storeType, tabular, type } from '../theme/tokens';
import { ProblemText } from '../ui/kit';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { Text } from '../ui/text';
import { ibanInGroups } from './account';
import { splitAround } from './money';

/** How long a copy button says «Хуулсан». */
const COPIED_MS = 2_000;

/**
 * «Дансны мэдээлэл», opened by the ⓘ on «Тооцоо» (the owner 2026-11-06): the accounts finance shows
 * customers, each with its bank, holder, IBAN and number; the IBAN and the number copied with one
 * press. The confirmation stays on the button: a toast would sit behind the sheet.
 */
export function BankInfoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      fit
      header={
        <SheetHeader
          title={t('mobile.customer.account.bankInfo.title')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
    >
      <BankList />
    </Sheet>
  );
}

function BankList() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const banks = useBankAccounts();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (key: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      // The phone refused the clipboard: nothing was copied, the button keeps saying «Хуулах».
      return;
    }
    setCopiedKey(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedKey(null), COPIED_MS);
  };

  const accounts = banks.data ?? [];
  const advice = t('mobile.customer.account.adviceMust');
  const strong = splitAround(advice, t('mobile.customer.account.adviceMustStrong'));

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.body,
        { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
      ]}
    >
      {banks.isLoading ? <ActivityIndicator style={styles.state} color={colors.primary} /> : null}
      {banks.error ? <ProblemText problem={problemFrom(banks.error)} /> : null}
      {banks.isSuccess && accounts.length === 0 ? (
        <Text style={[type.row, styles.state, styles.center]}>
          {t('mobile.customer.account.bankInfo.empty')}
        </Text>
      ) : null}
      {accounts.map((bank) => (
        <BankCard key={bank.id} bank={bank} copiedKey={copiedKey} onCopy={copy} />
      ))}
      {accounts.length > 0 ? (
        <Text style={[type.secondary, styles.advice]}>
          {strong ? (
            <>
              {strong[0]}
              <Text style={styles.adviceStrong}>{strong[1]}</Text>
              {strong[2]}
            </>
          ) : (
            advice
          )}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function BankCard({
  bank,
  copiedKey,
  onCopy,
}: {
  bank: StoreBankAccount;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const label = (name: 'bank' | 'holder' | 'iban' | 'number') =>
    t(`mobile.customer.account.bankInfo.${name}`);
  const ibanKey = `${bank.id}:iban`;
  const numberKey = `${bank.id}:number`;
  return (
    <View style={styles.card}>
      <InfoRow label={label('bank')} shown={bank.bankName ?? bank.name} />
      <InfoRow label={label('holder')} shown={bank.accountHolder} />
      <InfoRow
        label={label('iban')}
        shown={bank.iban ? ibanInGroups(bank.iban) : null}
        numeric
        copied={copiedKey === ibanKey}
        onCopy={bank.iban ? () => void onCopy(ibanKey, bank.iban ?? '') : undefined}
      />
      <InfoRow
        label={label('number')}
        shown={bank.bankAccountNo}
        numeric
        copied={copiedKey === numberKey}
        onCopy={
          bank.bankAccountNo ? () => void onCopy(numberKey, bank.bankAccountNo ?? '') : undefined
        }
      />
    </View>
  );
}

/** A label over its value, with «Хуулах» when the value can be copied; «—» when nothing is set. */
function InfoRow({
  label,
  shown,
  numeric = false,
  copied = false,
  onCopy,
}: {
  label: string;
  shown: string | null;
  numeric?: boolean;
  copied?: boolean;
  onCopy?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Text style={storeType.sectionSub}>{label}</Text>
        <Text selectable style={[type.rowStrong, numeric && tabular]}>
          {shown ?? t('common.none')}
        </Text>
      </View>
      {onCopy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.customer.account.bankInfo.copy', { name: label })}
          onPress={onCopy}
          hitSlop={8}
          style={({ pressed }) => [
            styles.copy,
            copied && styles.copyDone,
            pressed && styles.copyPressed,
          ]}
        >
          {copied ? (
            <Check size={14} strokeWidth={2.6} color={colors.success} />
          ) : (
            <Copy size={14} strokeWidth={2.2} color={colors.primary} />
          )}
          <Text style={[styles.copyText, copied && styles.copyTextDone]}>
            {copied ? t('mobile.customer.account.copied') : t('common.copy')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, gap: spacing.md },
  state: { marginVertical: spacing.xl },
  center: { textAlign: 'center', color: colors.muted },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  card: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: spacing.xs },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  copy: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.secondary,
  },
  copyDone: { backgroundColor: colors.successSoft },
  copyPressed: { opacity: 0.6 },
  copyText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.primary },
  copyTextDone: { color: colors.success },
  advice: { paddingHorizontal: spacing.xs, color: colors.label2 },
  adviceStrong: { fontFamily: fonts.semibold, color: colors.foreground },
});
