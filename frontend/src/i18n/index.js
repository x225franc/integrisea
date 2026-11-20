import { createI18n } from 'vue-i18n';
import fr from './fr.json';
import en from './en.json';
import frModules from './fr.modules.json';
import enModules from './en.modules.json';

const KEY = 'integrisea_locale';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => {
	const out = { ...a };
	for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
	return out;
};

export const i18n = createI18n({
	legacy: false,
	locale: read() || 'fr', // français par défaut
	fallbackLocale: 'fr',
	messages: { fr: merge(fr, frModules), en: merge(en, enModules) },
});

export function setLocale(l) {
	i18n.global.locale.value = l;
	document.documentElement.lang = l;
	try { localStorage.setItem(KEY, l); } catch { /* stockage indisponible */ }
}
