import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { loadAsync } from 'expo-font';
import { fonts } from '../theme/tokens';

/** React DOM's complaint about a pressable row holding its own button (a star, a «+»). */
const NESTED = /cannot (be a descendant of|contain a nested)/;

/**
 * The web copy of the app (`pnpm mobile:web`, the screens on a computer): the four Inter faces a
 * phone has built in, under the names `fonts` uses; and quiet about a row's own button inside the
 * row. That is a pressable inside a pressable, which Android handles and a browser's HTML forbids;
 * on the web it only covered the tab bar with a red toast.
 */
export function setUpWeb(): void {
  void loadAsync({
    [fonts.regular]: Inter_400Regular,
    [fonts.medium]: Inter_500Medium,
    [fonts.semibold]: Inter_600SemiBold,
    [fonts.bold]: Inter_700Bold,
  }).catch(() => undefined);

  const error = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (NESTED.test(text) && text.includes('button')) return;
    error(...args);
  };
}
