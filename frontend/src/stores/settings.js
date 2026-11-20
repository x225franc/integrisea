import { reactive } from 'vue';
import { api } from '@/api';

/** Configuration serveur (matrice, intervalles, échelles…), rechargée après chaque modification. */
export const settings = reactive({
	data: null,
	async load(force = false) {
		if (this.data && !force) return this.data;
		this.data = await api('/settings');
		return this.data;
	},
});
