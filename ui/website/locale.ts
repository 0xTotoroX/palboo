/* [INPUT]: Browser language, URL and this website's saved preference.
 * [OUTPUT]: Website-only messages and an independent language selection.
 * [POS]: Does not read or write App configuration. */
import { registerMessages, setLocale } from '../shared/i18n.js';
import messages from './locales/en.js';
registerMessages(messages);
let preference = new URLSearchParams(location.search).get('lang');
try {
  preference ||= localStorage.getItem('palboo-site-language');
} catch {
  /* In-memory language still works. */
}
setLocale(preference || 'system');
