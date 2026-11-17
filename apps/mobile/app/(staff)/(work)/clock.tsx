import { useMemo } from 'react';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import AttendanceScreen from '../attendance';
import { useStoreTabBarHeight } from '../../../src/ui/store-tab-bar';

/**
 * «Ирц», the second tab: the attendance screen itself (`/attendance`, which the other links still
 * open over the tabs). It keeps the whole height for its map and its sliding sheet, and is told
 * that the tab bar is its bottom edge: the low sheet then shows above the bar, and the high one
 * still stops under the status bar.
 */
export default function AttendanceTab() {
  const insets = useSafeAreaInsets();
  const bar = useStoreTabBarHeight();
  const above = useMemo(() => ({ ...insets, bottom: bar }), [insets, bar]);
  return (
    <SafeAreaInsetsContext.Provider value={above}>
      <AttendanceScreen />
    </SafeAreaInsetsContext.Provider>
  );
}
