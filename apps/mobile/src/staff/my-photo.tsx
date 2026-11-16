import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { useMyProfile } from '../api/community';
import { useSignedIn } from '../state/session';

/**
 * The signed-in person's own photo, as HR set it, laid over the circle that holds their initials:
 * nothing is drawn until the server names one, so the initials show meanwhile and without a photo.
 */
export function MyPhoto({ size }: { size: number }) {
  const { server } = useSignedIn();
  const photoUrl = useMyProfile().data?.photoUrl ?? null;
  if (!photoUrl) return null;
  return (
    <Image
      source={{ uri: `${server}${photoUrl}` }}
      style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
      contentFit="cover"
      cachePolicy="memory-disk"
    />
  );
}
