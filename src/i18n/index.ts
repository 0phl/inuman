import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '@/core/content/schemas';
import { useSettings } from '@/store/settings';
import enCommon from './locales/en/common.json';
import enGames from './locales/en/games.json';
import tlCommon from './locales/taglish/common.json';
import tlGames from './locales/taglish/games.json';

export const HTML_LANG: Record<Locale, string> = { taglish: 'fil', en: 'en' };

const applyHtmlLang = (lng: string) => {
  document.documentElement.lang = HTML_LANG[lng as Locale] ?? 'en';
};

i18n.on('languageChanged', applyHtmlLang);

void i18n.use(initReactI18next).init({
  resources: {
    taglish: { common: tlCommon, games: tlGames },
    en: { common: enCommon, games: enGames },
  },
  lng: useSettings.getState().locale,
  fallbackLng: { taglish: ['en'], default: ['en'] },
  supportedLngs: ['taglish', 'en'],
  ns: ['common', 'games'],
  defaultNS: 'common',
  fallbackNS: 'games',
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

applyHtmlLang(i18n.language);

useSettings.subscribe((s, prev) => {
  if (s.locale !== prev.locale) void i18n.changeLanguage(s.locale);
});

export default i18n;
