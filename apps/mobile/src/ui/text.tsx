import type { ComponentProps, Ref } from 'react';
import { Text as NativeText, TextInput as NativeTextInput } from 'react-native';
import { APP } from '../config/app';
import { fontScaleCap } from '../theme/font-scale';

/**
 * How far the phone's font size setting may enlarge the app's text: 1.15 in the rep app (the owner
 * found it too big, 2026-10-17), none in «Bto300» (its sizes are E-mart's, ADR-0095).
 */
export const MAX_FONT_SCALE = fontScaleCap(APP.variant);

/**
 * React Native's Text with the font scaling capped. React 19 ignores `defaultProps` on function
 * components, so every screen imports Text from here (an ESLint rule forbids react-native's).
 */
export function Text(props: ComponentProps<typeof NativeText>) {
  return <NativeText maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} />;
}

/** React Native's TextInput with the font scaling capped; `ref` passes through (React 19). */
export function TextInput(
  props: ComponentProps<typeof NativeTextInput> & { ref?: Ref<NativeTextInput> },
) {
  return <NativeTextInput maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} />;
}

/** The TextInput a ref points at. */
export type TextInput = NativeTextInput;
