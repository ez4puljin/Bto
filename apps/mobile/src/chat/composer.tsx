import { SendHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing, type } from '../theme/tokens';
import { Text, TextInput } from '../ui/text';
import { charsLeft, sendableText } from './logic';

/** The input of a chat: a growing field limited to the message length, and the send button. */
export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const text = sendableText(input);
  const left = charsLeft(input);
  const submit = () => {
    if (text === null) return;
    setInput('');
    onSend(text);
  };
  return (
    <View style={styles.bar}>
      <View style={styles.field}>
        <TextInput
          accessibilityLabel={t('mobile.chat.placeholder')}
          placeholder={t('mobile.chat.placeholder')}
          placeholderTextColor={colors.placeholder}
          cursorColor={colors.primary}
          value={input}
          onChangeText={setInput}
          multiline
          style={[type.field, styles.input]}
        />
        {left < 0 ? (
          <Text style={[type.caption, styles.over]}>{t('mobile.chat.tooLong', { n: -left })}</Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mobile.chat.send')}
        accessibilityState={{ disabled: text === null }}
        disabled={text === null}
        onPress={submit}
        style={[styles.send, text === null && styles.sendOff]}
      >
        <SendHorizontal size={20} strokeWidth={2.2} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  field: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  input: { maxHeight: 120, minHeight: 40, paddingVertical: 10 },
  over: { color: colors.destructive, paddingBottom: 6 },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: colors.input },
});
