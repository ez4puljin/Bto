import { Image } from 'expo-image';
import { Package } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { pageAt } from '../images/pictures';
import { colors, shadows } from '../theme/tokens';

/**
 * A grid card's pictures (the owner, 2026-10-17): one thumbnail, or a swipe through all of them with
 * dots when the product has more. Only the first loads until the rep starts to swipe; a tap opens
 * the product like the rest of the card. Thumbnails come from the phone's disk cache. The rep's card
 * is square with the dots on the right; «Bto300»'s card (ADR-0092 #7) is wider than high, shows the
 * whole picture and keeps its right corner for ♡.
 */
export function CardPictures({
  urls,
  server,
  dim,
  onPress,
  fit = 'cover',
  dots = 'right',
}: {
  urls: readonly string[];
  server: string;
  /** Nothing left in stock: the pictures fade. */
  dim: boolean;
  onPress: () => void;
  fit?: 'cover' | 'contain';
  dots?: 'left' | 'right';
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width;
  const [page, setPage] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const first = urls[0];
  if (first === undefined) {
    return (
      <Package size={44} strokeWidth={1.4} color={colors.input} style={dim ? styles.dim : null} />
    );
  }
  if (urls.length === 1) return <Picture url={first} server={server} dim={dim} fit={fit} />;
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) =>
        setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
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
              style={{ width, height: size.height }}
            >
              {index === 0 || swiped ? (
                <Picture url={url} server={server} dim={dim} fit={fit} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View
        pointerEvents="none"
        style={[styles.capsule, dots === 'left' ? styles.capsuleLeft : styles.capsuleRight]}
      >
        {urls.map((url, index) => (
          <View key={url} style={[styles.dot, index === page && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

function Picture({
  url,
  server,
  dim,
  fit,
}: {
  url: string;
  server: string;
  dim: boolean;
  fit: 'cover' | 'contain';
}) {
  return (
    <Image
      source={{ uri: `${server}${url}` }}
      style={[styles.image, dim && styles.dim]}
      contentFit={fit}
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
    height: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: colors.pagerCapsule,
    boxShadow: shadows.capsule,
  },
  capsuleLeft: { left: 10 },
  capsuleRight: { right: 10 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.dotOnImageIdle },
  dotOn: { backgroundColor: colors.dotOnImage },
});
