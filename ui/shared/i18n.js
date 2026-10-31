/* [INPUT]: Bundled UI messages, a saved language preference and backend system locale.
 * [OUTPUT]: Synchronous Chinese/English translation, locale changes and subscriptions.
 * [POS]: Shared presentation-only localization; never translates user data or contacts a service.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createInstance } from 'i18next';
import messages from './locales/en.js';

let systemLocale = null;
const engine = createInstance();
void engine.init({
  lng: 'zh-CN',
  showSupportNotice: false,
  fallbackLng: false,
  initImmediate: false,
  keySeparator: false,
  nsSeparator: false,
  resources: { en: { translation: messages }, 'zh-CN': { translation: {} } },
  interpolation: { escapeValue: false },
});

/** @param {'system' | 'zh-CN' | 'en' | string | null | undefined} preference */
export function resolveLocale(preference) {
  if (preference === 'en' || preference === 'zh-CN') return preference;
  if (systemLocale) return systemLocale;
  const languages = typeof navigator === 'undefined' ? ['zh-CN'] : navigator.languages;
  return /^zh(?:-|$)/i.test(languages?.[0] || 'en') ? 'zh-CN' : 'en';
}

export const getLocale = () => (engine.language === 'en' ? 'en' : 'zh-CN');

/** @param {string|null|undefined} preference @param {string|null|undefined} [systemLanguage] */
export function setLocale(preference, systemLanguage) {
  if (systemLanguage === 'zh-CN' || systemLanguage === 'en') systemLocale = systemLanguage;
  const next = resolveLocale(preference);
  if (next !== getLocale()) void engine.changeLanguage(next);
}

export function subscribeLocale(listener) {
  engine.on('languageChanged', listener);
  return () => engine.off('languageChanged', listener);
}

/** Only authored UI messages belong here. User names, drafts and model output stay untouched. */
export function tr(source, values = {}) {
  return String(engine.t(source, { ...values, defaultValue: source }));
}

/** Website-only copy is registered by the website entry and never bundled into the App. */
export function registerMessages(values) {
  engine.addResourceBundle('en', 'translation', values, true, true);
}

export function formatNumber(value, options) {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}
