import mn from '@tugeel/shared/i18n/mn.json';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

/** Mongolian is the only locale (ADR-0011); every UI string is a key of packages/shared/i18n/mn.json. */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: 'mn',
  fallbackLng: 'mn',
  supportedLngs: ['mn'],
  defaultNS: 'translation',
  resources: { mn: { translation: mn } },
  initAsync: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});
