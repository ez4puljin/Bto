import { Phone } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StoreContact } from '../api/customer';
import { callNow } from '../phone/call';
import { brandSheet } from '../theme/brand';
import { AVATAR_TINTS, colors, fonts, spacing, tabular, TOUCH, type } from '../theme/tokens';
import { Group } from '../ui/grouped';
import { Text } from '../ui/text';
import { useToast } from '../ui/toast';
import { contactInitialsOf, phoneShown, shownContacts } from './home';

/**
 * «Холбоо барих» on «Профайл» (ADR-0079 #14, ADR-0092 #8; the Profile board): the company's
 * contact people the admins show, in their order; a tap anywhere on a row calls at once (the
 * permission is asked on the first tap, the dialer opens after a «no»).
 */
export function Contacts({ contacts }: { contacts: StoreContact[] | undefined }) {
  const { t } = useTranslation();
  const toast = useToast();
  if (!contacts) return null;
  const people = shownContacts(contacts);

  const call = async (contact: StoreContact) => {
    const phone = phoneShown(contact.phone);
    const outcome = await callNow(contact.phone);
    if (outcome !== 'none') {
      toast.show({ message: t('mobile.customer.contacts.calling', { role: contact.role, phone }) });
    }
  };

  return (
    <>
      <View style={styles.title}>
        <Text accessibilityRole="header" style={[type.sectionTitle, styles.grow]} numberOfLines={1}>
          {t('mobile.customer.contacts.title')}
        </Text>
        {people.length > 0 ? (
          <Text style={type.secondary}>{t('mobile.customer.contacts.hint')}</Text>
        ) : null}
      </View>
      {people.length === 0 ? (
        <Text style={[type.secondary, styles.empty]}>{t('mobile.customer.contacts.empty')}</Text>
      ) : (
        <Group>
          {people.map((contact, index) => {
            const phone = phoneShown(contact.phone);
            return (
              <Pressable
                key={contact.id}
                accessibilityRole="button"
                accessibilityLabel={t('mobile.customer.contacts.callLabel', {
                  role: contact.role,
                  phone,
                })}
                onPress={() => void call(contact)}
                style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: AVATAR_TINTS[index % AVATAR_TINTS.length] },
                  ]}
                >
                  <Text style={styles.initials}>{contactInitialsOf(contact.role)}</Text>
                </View>
                <View style={styles.grow}>
                  <Text style={type.rowStrong} numberOfLines={2}>
                    {contact.role}
                  </Text>
                  <Text style={type.secondary} numberOfLines={1}>
                    {contact.name}
                  </Text>
                  <Text style={[type.row, styles.phone]} numberOfLines={1}>
                    {phone}
                  </Text>
                </View>
                <View style={styles.callButton}>
                  <Phone size={20} strokeWidth={2.2} color={colors.primaryForeground} />
                </View>
              </Pressable>
            );
          })}
        </Group>
      )}
    </>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    grow: { flex: 1 },
    title: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.sm,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
      marginHorizontal: spacing.xs,
    },
    empty: { paddingHorizontal: spacing.xs },
    contact: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 10,
      paddingLeft: spacing.lg,
      paddingRight: 14,
    },
    pressed: { backgroundColor: colors.accent },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initials: { ...type.bodyStrong, fontFamily: fonts.bold, color: colors.primaryForeground },
    phone: { ...tabular, color: colors.link },
    callButton: {
      width: TOUCH,
      height: TOUCH,
      borderRadius: TOUCH / 2,
      backgroundColor: colors.tint.green,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
