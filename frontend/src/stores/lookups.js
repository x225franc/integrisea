import { reactive } from 'vue';
import { api } from '@/api';

/** Données de référence partagées (installations, systèmes, classes), rechargées à la demande. */
export const lookups = reactive({
	facilities: [],
	systems: [],
	classes: [],
	loaded: false,
	async load(force = false) {
		if (this.loaded && !force) return;
		const [f, s, c] = await Promise.all([api('/facilities'), api('/systems'), api('/classes')]);
		this.facilities = f; this.systems = s; this.classes = c; this.loaded = true;
	},
	reset() { this.loaded = false; },
	className(code, locale) {
		const c = this.classes.find((x) => x.code === code);
		return c ? (locale === 'en' ? c.nameEn : c.nameFr) : code;
	},
});
