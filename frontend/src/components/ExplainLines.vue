<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { num } from '@/utils';

// Affiche les lignes explicatives du moteur ({ code, params }) dans la langue de l'utilisateur.
const props = defineProps({ lines: { type: Array, required: true } });
const { t } = useI18n();

function render(line) {
	const p = { ...line.params };
	let code = line.code;
	if (code === 'tmin') {
		code = `tmin_${p.formula}`;
		p.governs = t(`explain.governs_${p.governs}`);
		for (const k of ['P', 'D', 'R', 'S', 'tCalc', 'tStruct', 'tmin']) if (k in p) p[k] = num(p[k], 2);
	}
	if (code === 'cof') p.sceTxt = p.sce ? t('explain.sceYes') : '';
	if (code === 'corrosion') {
		p.floored = p.floored ? t('explain.floored') : '';
		p.crLT = num(p.crLT, 3); p.crST = num(p.crST, 3); p.cr = num(p.cr, 3);
	}
	if (code === 'remaining_life') {
		p.belowTmin = p.belowTmin ? t('explain.belowTmin') : '';
		for (const k of ['tLast', 'tmin']) p[k] = num(p[k], 2);
		for (const k of ['cr']) p[k] = num(p[k], 3);
		for (const k of ['rlAtLast', 'since', 'rl']) p[k] = num(p[k], 1);
	}
	if (code === 'pof_from_rl') p.rl = num(p.rl, 1);
	if (code === 'interval_cap_rl') p.rlAtLast = num(p.rlAtLast, 1);
	if (code === 'due_date') p.status = t(`sched.${p.status}`);
	if (code === 'tmin_missing') p.missing = (p.missing || []).join(', ');
	if (code === 'grade_deviation') p.deviation = num(p.deviation * 100, 1);
	if (code === 'below_tmin') { p.tLast = num(p.tLast, 2); p.tmin = num(p.tmin, 2); }
	if (code === 'rl_under_2' || code === 'rl_under_5') p.rl = num(p.rl, 1);
	for (const k of ['s', 'e', 'p']) if (k in p && p[k] === null) p[k] = '—';
	return t(`explain.${code}`, p);
}
const items = computed(() => props.lines.map((l, i) => ({ i, text: render(l), code: l.code })));
const warn = (c) => ['tmin_missing', 'tmin_invalid_geometry', 'consequence_default', 'no_base_date', 'mod_overdue', 'mod_open_anomaly'].includes(c);
</script>

<template>
	<ol class="explain mb-0">
		<li v-for="l in items" :key="l.i" :class="{ warn: warn(l.code) }">{{ l.text }}</li>
	</ol>
</template>

<style scoped>
.explain { padding-left: 1.4rem; font-size: 0.86rem; }
.explain li { margin-bottom: 0.3rem; }
.explain li.warn { color: #9a4a00; }
</style>
