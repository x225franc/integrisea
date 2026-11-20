import { createI18n } from 'vue-i18n';
import fr from './fr.json';
import en from './en.json';

const KEY = 'integrisea_locale';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const i18n = createI18n({
	legacy: false,
	locale: read() || 'fr', // français par défaut
	fallbackLocale: 'fr',
	messages: { fr, en },
});

export function setLocale(l) {
	i18n.global.locale.value = l;
	document.documentElement.lang = l;
	try { localStorage.setItem(KEY, l); } catch { /* stockage indisponible */ }
}
