import type mn from '@tugeel/shared/i18n/mn.json';
import 'i18next';

// Typed translation keys: a missing key is a compile error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof mn };
  }
}
