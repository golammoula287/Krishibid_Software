import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import bn from '../locales/bn.json';
import en from '../locales/en.json';

const STORAGE_KEY = 'krishibid_locale';

export type Locale = 'bn' | 'en';

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'bn' || stored === 'en') return stored;
  // Bangla-first: the target user is a Bangladeshi farmer, so `bn` is the default
  // rather than a fallback chosen only when the browser asks for it.
  return navigator.language.startsWith('en') ? 'en' : 'bn';
}

void i18next.use(initReactI18next).init({
  resources: {
    bn: { translation: bn },
    en: { translation: en },
  },
  lng: detectLocale(),
  fallbackLng: 'bn',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}

export const currentLocale = (): Locale => (i18next.language === 'en' ? 'en' : 'bn');

document.documentElement.lang = currentLocale();

export default i18next;
