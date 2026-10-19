import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { LocateFixed, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  Linking,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { REP_MAP_FRESH_DAYS } from '@tugeel/shared/sales';
import { problemFrom } from '../../src/api/problem';
import { useRepMap } from '../../src/api/rep';
import { callNow } from '../../src/phone/call';
import StoreMap from '../../src/map/store-map';
import { StorePicker } from '../../src/map/store-picker';
import { STORE_SHEET_HEIGHT, StoreSheet } from '../../src/map/store-sheet';
import { countsOf, type MapPoint, pinsOf, storesWithIds } from '../../src/map/stores';
import { useShop } from '../../src/state/shop';
import { colors, radii, shadows, spacing, tabular, type } from '../../src/theme/tokens';
import { ChoiceChip, CircleButton, PillButton } from '../../src/ui/controls';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { NavBar, Page } from '../../src/ui/layout';
import { Text } from '../../src/ui/text';
import { useToast } from '../../src/ui/toast';

type Whereabouts = 'asking' | 'on' | 'denied' | 'off';

/** How old the phone's last known position may be to open the map on it. */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60_000;

/**
 * «Газрын зураг» (the owner, 2026-10-18): every active store with a GPS point and its name, red
 * without an order of this rep in the last 7 days, green with one and black when the accountant
 * closed its orders, the rep's own position (where the map opens), and a store's card on a tap
 * (start an order, its order history, a direct call); stores at one point are listed to pick
 * from. Tiles are OpenStreetMap's through OpenFreeMap (no key); the map is a DOM component
 * (src/map/store-map.tsx).
 */
export default function MapScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { pending, dispatch } = useShop();
  const map = useRepMap();
  const [onlyStale, setOnlyStale] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** The stores of a tap on several pins at one point, until the rep picks one. */
  const [stackIds, setStackIds] = useState<number[] | null>(null);
  const [me, setMe] = useState<MapPoint | null>(null);
  const [where, setWhere] = useState<Whereabouts>('asking');
  const [locate, setLocate] = useState(0);
  /** The map did not load (no internet, no WebGL); «try again» mounts a new one. */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stores = useMemo(() => map.data?.data ?? [], [map.data]);
  const pins = useMemo(
    () => (map.data ? pinsOf(map.data.data, onlyStale) : null),
    [map.data, onlyStale],
  );
  const counts = useMemo(() => countsOf(stores), [stores]);
  const selected = stores.find((store) => store.customerId === selectedId) ?? null;
  const stack = useMemo(() => {
    const listed = stackIds ? storesWithIds(stores, stackIds) : [];
    return listed.length > 0 ? listed : null;
  }, [stores, stackIds]);
  const freshDays = map.data?.freshDays ?? REP_MAP_FRESH_DAYS;

  // The rep's own position while the screen is open: foreground only, never in the background.
  const watch = useRef<Location.LocationSubscription | null>(null);
  const starting = useRef(false);
  const alive = useRef(true);
  const asked = useRef(false);
  /** The store whose card a page opened from it left; it opens again on the way back. */
  const reopen = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      watch.current?.remove();
      watch.current = null;
    };
  }, []);

  /**
   * Starts following the phone's position. `ask` puts the permission question (the first open and
   * the «my location» button); otherwise the permission is only read (back on the screen or in the
   * app, so a question the rep refused never comes back by itself). Resolves to the new state, or
   * null when it was already following or started.
   */
  const startLocation = useCallback(async (ask: boolean): Promise<Whereabouts | null> => {
    if (watch.current || starting.current) return null;
    starting.current = true;
    try {
      const permission = ask
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (!alive.current) return null;
      if (!permission.granted) {
        setWhere('denied');
        return 'denied';
      }
      // The phone's last fix, if recent, opens the map on the rep at once (store-map.tsx); the
      // watch's first fix can take seconds, replaces it and, as it is live (`meLive`), moves the
      // map there once more unless the rep has moved it.
      void Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).then(
        (position) => {
          if (!alive.current || !position) return;
          const { latitude: lat, longitude: lng } = position.coords;
          setMe((current) => current ?? { lat, lng });
        },
        () => undefined,
      );
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 5_000 },
        (position) => {
          setMe({ lat: position.coords.latitude, lng: position.coords.longitude });
          setWhere('on');
        },
        () => setWhere((current) => (current === 'on' ? current : 'off')),
      );
      if (!alive.current) {
        subscription.remove();
        return null;
      }
      watch.current = subscription;
      setWhere((current) => (current === 'on' ? current : 'asking'));
      return 'asking';
    } catch {
      // The phone's location is switched off.
      if (!alive.current) return null;
      setWhere('off');
      return 'off';
    } finally {
      starting.current = false;
    }
  }, []);

  // The first focus asks; a later one (back from an order or a store's settings) only reads the
  // permission the rep may have given meanwhile.
  useFocusEffect(
    useCallback(() => {
      const ask = !asked.current;
      asked.current = true;
      void startLocation(ask);
      // Back from a store's history or order: its card again.
      if (reopen.current !== null) {
        setSelectedId(reopen.current);
        reopen.current = null;
      }
    }, [startLocation]),
  );

  /**
   * Opens a page from the store card: the card (a modal over everything) closes first and comes
   * back when the rep returns to the map.
   */
  const leaveCard = (go: () => void) => {
    reopen.current = selectedId;
    setSelectedId(null);
    go();
  };

  // Back from the phone's settings: the permission or the location may be on now.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void startLocation(false);
    });
    return () => subscription.remove();
  }, [startLocation]);

  const tellWhere = useCallback(
    (state: Whereabouts) => {
      if (state === 'denied') {
        toast.show({
          message: t('mobile.map.locationDenied'),
          action: {
            label: t('mobile.map.openSettings'),
            onPress: () => void Linking.openSettings(),
          },
        });
      } else if (state === 'off') {
        toast.show({ message: t('mobile.map.locationOff') });
      } else if (state === 'asking') {
        toast.show({ message: t('mobile.map.locating'), durationMs: 2_500 });
      }
    },
    [t, toast],
  );

  // Said once when the position cannot be had; the map works without it.
  useEffect(() => {
    if (where === 'denied' || where === 'off') tellWhere(where);
  }, [where, tellWhere]);

  const onMyLocation = () => {
    if (me) {
      setLocate((value) => value + 1);
      return;
    }
    if (watch.current || starting.current) {
      tellWhere(where);
      return;
    }
    // Asks again (the permission may have been refused once); the effect above tells a new
    // «denied» or «off», this tells the same one again and «locating».
    void startLocation(true).then((next) => {
      if (next !== null && (next === where || next === 'asking')) tellWhere(next);
    });
  };

  const onPinPress = useCallback((customerId: number) => {
    setStackIds(null);
    setSelectedId(customerId);
    return Promise.resolve();
  }, []);

  const onPinsPress = useCallback((customerIds: number[]) => {
    setSelectedId(null);
    setStackIds(customerIds);
    return Promise.resolve();
  }, []);

  const onMapError = useCallback(() => {
    setFailed(true);
    return Promise.resolve();
  }, []);

  const onMapLoad = useCallback(() => {
    setFailed(false);
    return Promise.resolve();
  }, []);

  const sheetTop = Math.max(62, height - insets.top - STORE_SHEET_HEIGHT);
  const loading = map.isLoading;

  return (
    <Page>
      <NavBar
        back={t('mobile.tabs.home')}
        onBack={() => router.back()}
        title={t('mobile.map.title')}
      />
      <View style={styles.area} accessibilityLabel={t('mobile.map.label')}>
        <StoreMap
          key={attempt}
          pins={pins}
          me={me}
          meLive={where === 'on'}
          locating={where === 'asking'}
          selectedId={selectedId}
          locate={locate}
          cardHeight={STORE_SHEET_HEIGHT}
          insetBottom={insets.bottom}
          onPinPress={onPinPress}
          onPinsPress={onPinsPress}
          onMapError={onMapError}
          onMapLoad={onMapLoad}
          dom={{ style: styles.map, scrollEnabled: false }}
        />

        <View style={styles.top} pointerEvents="box-none">
          <View style={styles.raised}>
            <ChoiceChip
              label={t('mobile.map.onlyStale')}
              selected={onlyStale}
              onPress={() => setOnlyStale((value) => !value)}
              icon={
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: onlyStale ? colors.primaryForeground : colors.tint.red },
                  ]}
                />
              }
            />
          </View>
          <View style={styles.legend} accessibilityRole="summary">
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: colors.tint.red }]} />
                  <Text style={[type.chip, tabular]}>
                    {t('mobile.map.legendStale', { n: counts.stale })}
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: colors.tint.green }]} />
                  <Text style={[type.chip, tabular]}>
                    {t('mobile.map.legendFresh', { n: counts.fresh })}
                  </Text>
                </View>
                {counts.blocked > 0 ? (
                  <View style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: colors.blocked }]} />
                    <Text style={[type.chip, tabular]}>
                      {t('mobile.map.legendBlocked', { n: counts.blocked })}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
          {map.error ? (
            <ProblemText problem={problemFrom(map.error)} style={styles.problem} />
          ) : null}
        </View>

        {failed ? (
          <View style={styles.emptyWrap} pointerEvents="box-none">
            <View style={styles.empty}>
              <EmptyState
                icon={<WifiOff size={28} strokeWidth={2} color={colors.muted} />}
                title={t('mobile.map.failed')}
                hint={t('mobile.map.failedHint')}
              />
              <PillButton
                title={t('mobile.map.retry')}
                variant="soft"
                height={44}
                style={styles.retry}
                onPress={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              />
            </View>
          </View>
        ) : map.data && stores.length === 0 ? (
          <View style={styles.emptyWrap} pointerEvents="none">
            <View style={styles.empty}>
              <EmptyState title={t('mobile.map.noStores')} hint={t('mobile.map.noStoresHint')} />
            </View>
          </View>
        ) : null}

        <CircleButton
          icon={
            <LocateFixed
              size={22}
              strokeWidth={2}
              color={where === 'on' ? colors.primary : colors.muted}
            />
          }
          label={t('mobile.map.myLocation')}
          onPress={onMyLocation}
          style={[styles.locate, { bottom: insets.bottom + spacing.lg }]}
        />
      </View>

      <StorePicker
        stores={stack}
        onClose={() => setStackIds(null)}
        onPick={(customerId) => {
          setStackIds(null);
          setSelectedId(customerId);
        }}
      />

      <StoreSheet
        store={selected}
        today={map.data?.today ?? null}
        freshDays={freshDays}
        top={sheetTop}
        sendPending={pending !== null}
        onClose={() => setSelectedId(null)}
        onStart={(customer, addressId) => {
          // The address is the tapped point's own (store-sheet.tsx), not always the default.
          dispatch({ type: 'customer', customer, defaultAddressId: addressId });
          setSelectedId(null);
          // Back to the tabs, on the shop: the map, its web view and the position watch unmount.
          router.dismissTo('/shop');
          toast.show({ message: t('mobile.map.customerSet', { name: customer.name }) });
        }}
        onHistory={(store) =>
          leaveCard(() =>
            router.push({
              pathname: '/store-orders/[id]',
              params: { id: String(store.customerId), name: store.name },
            }),
          )
        }
        onOpenOrder={(orderId) => leaveCard(() => router.push(`/order/${orderId}`))}
        onCall={(phone) => void callNow(phone)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, backgroundColor: colors.canvas },
  map: { flex: 1 },
  top: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  raised: { borderRadius: 17, boxShadow: shadows.floating },
  problem: { marginTop: 0, alignSelf: 'stretch' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legend: {
    minWidth: 64,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.floatingFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineSoft,
    boxShadow: shadows.floating,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locate: { position: 'absolute', right: spacing.md },
  emptyWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  empty: {
    borderRadius: radii.card,
    backgroundColor: colors.floatingFill,
    boxShadow: shadows.floating,
  },
  retry: { alignSelf: 'center', marginTop: -spacing.md, marginBottom: spacing.xl },
});
