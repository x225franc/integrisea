import { reactive } from 'vue';
import { api } from '@/api';
import { settings } from '@/stores/settings';

/** Données de référence partagées (installations, systèmes, classes, disciplines), rechargées à la demande. */
export const lookups = reactive({
	facilities: [],
	systems: [],
	classes: [],
	disciplines: [],
	loaded: false,
	async load(force = false) {
		if (this.loaded && !force) return;
		const [f, s, c, cfg] = await Promise.all([api('/facilities'), api('/systems'), api('/classes'), settings.load(force)]);
		this.facilities = f; this.systems = s; this.classes = c; this.disciplines = cfg.disciplines ?? []; this.loaded = true;
	},
	reset() { this.loaded = false; },
	className(code, locale) {
		const c = this.classes.find((x) => x.code === code);
		return c ? (locale === 'en' ? c.nameEn : c.nameFr) : code;
	},
});
