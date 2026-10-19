import { Image } from 'expo-image';
import { Package } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { pageAt } from '../images/pictures';
import { colors, shadows } from '../theme/tokens';

/**
 * A grid card's pictures (the owner, 2026-10-17): one thumbnail, or a swipe through all of them with
 * dots when the product has more. Only the first loads until the rep starts to swipe; a tap opens
 * the product like the rest of the card. Thumbnails come from the phone's disk cache.
 */
export function CardPictures({
  urls,
  server,
  dim,
  onPress,
}: {
  urls: readonly string[];
  server: string;
  /** Nothing left in stock: the pictures fade. */
  dim: boolean;
  onPress: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const first = urls[0];
  if (first === undefined) {
    return (
      <Package size={44} strokeWidth={1.4} color={colors.input} style={dim ? styles.dim : null} />
    );
  }
  if (urls.length === 1) return <Picture url={first} server={server} dim={dim} />;
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => setSwiped(true)}
          onMomentumScrollEnd={(event) =>
            setPage(pageAt(event.nativeEvent.contentOffset.x, width, urls.length))
          }
        >
          {urls.map((url, index) => (
            <Pressable
              key={url}
              accessible={false}
              onPress={onPress}
              style={{ width, height: width }}
            >
              {index === 0 || swiped ? <Picture url={url} server={server} dim={dim} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View pointerEvents="none" style={styles.capsule}>
        {urls.map((url, index) => (
          <View key={url} style={[styles.dot, index === page && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

function Picture({ url, server, dim }: { url: string; server: string; dim: boolean }) {
  return (
    <Image
      source={{ uri: `${server}${url}` }}
      style={[styles.image, dim && styles.dim]}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={url}
      transition={120}
    />
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
  dim: { opacity: 0.55 },
  capsule: {
    position: 'absolute',
    top: 10,
    right: 10,
    height: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: colors.pagerCapsule,
    boxShadow: shadows.capsule,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.dotOnImageIdle },
  dotOn: { backgroundColor: colors.dotOnImage },
});
