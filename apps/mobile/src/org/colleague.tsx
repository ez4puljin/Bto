import { Image } from 'expo-image';
import { Mail, Phone, User } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { Colleague } from '../api/directory';
import { telUriOf } from '../phone/call';
import { useSignedIn } from '../state/session';
import { colors, fonts, radii, shadows, spacing, tabular, TOUCH, type } from '../theme/tokens';
import { Text } from '../ui/text';
import { mailUriOf, phoneLabel, roleLine } from './people';

// A colleague of «Манайхан» as a card of the grid and as a row of the list: the round photo (or a
// person), the name, the position, the number that dials and the envelope that writes.

/** Opens a `tel:` or `mailto:` link; a phone without the app for it does nothing. */
function openLink(uri: string | null) {
  if (uri) void Linking.openURL(uri).catch(() => undefined);
}

/** The card photo, or a person on a soft circle. */
export function ColleagueAvatar({ photoUrl, size }: { photoUrl: string | null; size: number }) {
  const { server } = useSignedIn();
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    return (
      <Image
        source={{ uri: `${server}${photoUrl}` }}
        style={[round, styles.photo]}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[round, styles.noPhoto]}>
      <User size={Math.round(size * 0.5)} strokeWidth={1.8} color={colors.link} />
    </View>
  );
}

/** The envelope: writes when there is an address, faded and still otherwise. */
function MailButton({ person, round = false }: { person: Colleague; round?: boolean }) {
  const { t } = useTranslation();
  const uri = mailUriOf(person.email);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        uri
          ? t('mobile.org.people.mail', { name: person.displayName })
          : t('mobile.org.people.noMail', { name: person.displayName })
      }
      accessibilityState={{ disabled: !uri }}
      disabled={!uri}
      onPress={() => openLink(uri)}
      hitSlop={6}
      style={({ pressed }) => [
        round ? styles.roundButton : styles.mail,
        !uri && styles.off,
        pressed && styles.pressed,
      ]}
    >
      <Mail size={18} strokeWidth={2} color={uri ? colors.link : colors.placeholder} />
    </Pressable>
  );
}

/** One card of the two-a-row grid. */
export function ColleagueCard({ person }: { person: Colleague }) {
  const { t } = useTranslation();
  const role = roleLine(person);
  const phone = person.phone;
  return (
    <View style={styles.card}>
      <ColleagueAvatar photoUrl={person.photoUrl} size={64} />
      <View style={styles.cardText}>
        <Text style={[type.rowStrong, styles.center]} numberOfLines={1}>
          {person.displayName}
        </Text>
        <Text style={[type.secondary, styles.center]} numberOfLines={1}>
          {role === '' ? ' ' : role}
        </Text>
      </View>
      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            phone
              ? t('mobile.org.people.call', { name: person.displayName, phone: phoneLabel(phone) })
              : t('mobile.org.people.noPhone')
          }
          accessibilityState={{ disabled: !phone }}
          disabled={!phone}
          onPress={() => openLink(phone ? telUriOf(phone) : null)}
          style={({ pressed }) => [styles.call, pressed && styles.pressed]}
        >
          <Phone size={15} strokeWidth={2.2} color={phone ? colors.link : colors.placeholder} />
          <Text
            style={[styles.number, tabular, !phone && styles.muted]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {phone ? phoneLabel(phone) : '—'}
          </Text>
        </Pressable>
        <MailButton person={person} />
      </View>
    </View>
  );
}

/** One row of the list: the same facts, the buttons at the right. */
export function ColleagueRow({ person }: { person: Colleague }) {
  const { t } = useTranslation();
  const role = roleLine(person);
  const phone = person.phone;
  return (
    <View style={styles.row}>
      <ColleagueAvatar photoUrl={person.photoUrl} size={46} />
      <View style={styles.rowText}>
        <Text style={type.rowStrong} numberOfLines={1}>
          {person.displayName}
        </Text>
        {role !== '' ? (
          <Text style={type.secondary} numberOfLines={1}>
            {role}
          </Text>
        ) : null}
        <Text style={[type.secondary, tabular, styles.rowNumber]} numberOfLines={1}>
          {phone ? phoneLabel(phone) : t('mobile.org.people.noPhone')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          phone
            ? t('mobile.org.people.call', { name: person.displayName, phone: phoneLabel(phone) })
            : t('mobile.org.people.noPhone')
        }
        accessibilityState={{ disabled: !phone }}
        disabled={!phone}
        onPress={() => openLink(phone ? telUriOf(phone) : null)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.roundButton,
          !phone && styles.off,
          pressed && styles.pressed,
        ]}
      >
        <Phone size={18} strokeWidth={2} color={phone ? colors.link : colors.placeholder} />
      </Pressable>
      <MailButton person={person} round />
    </View>
  );
}

const ROUND = 40;

const styles = StyleSheet.create({
  photo: { backgroundColor: colors.imageFill },
  noPhoto: {
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  muted: { color: colors.placeholder },
  pressed: { opacity: 0.6 },
  off: { opacity: 0.5 },
  card: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
  },
  cardText: { alignSelf: 'stretch', gap: 2 },
  cardActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  call: {
    flex: 1,
    minWidth: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.secondary,
  },
  number: { ...type.chip, fontFamily: fonts.semibold, color: colors.link, flexShrink: 1 },
  mail: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowNumber: { color: colors.label2 },
  roundButton: {
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
});
