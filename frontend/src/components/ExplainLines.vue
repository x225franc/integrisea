<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { num } from '@/utils';

// Affiche les lignes explicatives du moteur ({ code, params }) dans la langue de l'utilisateur.
const props = defineProps({ lines: { type: Array, required: true } });
const { t } = useI18n();

const pt = (p) => `${num(p.s, 1)} MPa @ ${num(p.tempC, 0)} °C`;

function render(line) {
	const p = { ...line.params };
	let code = line.code;
	if (code === 'tmin') {
		code = `tmin_${p.formula}`;
		p.governs = t(`explain.governs_${p.governs}`);
		for (const k of ['P', 'D', 'Ro', 'S', 'tCalc', 'tStruct', 'tmin']) if (k in p) p[k] = num(p[k], 2);
	}
	if (code === 'tmin_scope') code = `tmin_scope_${p.formula}`;
	if (code === 'stress_interpolated') { p.a = pt(p.from[0]); p.b = pt(p.from[1]); p.s = num(p.s, 1); }
	if (code === 'cof') p.sceTxt = p.sce ? t('explain.sceYes') : '';
	if (code === 'corrosion_cml') {
		p.refKind = t(`explain.ref_${p.refKind}`);
		for (const k of ['tRef', 'tLast']) p[k] = num(p[k], 2);
		for (const k of ['crLT', 'crST', 'cr']) p[k] = p[k] === null ? '—' : num(p[k], 3);
		p.floored = p.floored
			? t('explain.floored_txt', { floor: num(p.floor, 2), family: p.familyKnown ? t(`explain.family_${p.family}`) : t('explain.family_unknown') })
			: '';
		p.rlTxt = p.rlRaw === null ? '' : t('explain.rl_cml', { rlAtLast: num(p.rlAtLast, 1), rlRaw: num(p.rlRaw, 1) });
		p.gov = p.governing ? t('explain.gov_cml') : '';
	}
	if (code === 'cml_no_reference') p.tLast = num(p.tLast, 2);
	if (code === 'remaining_life') {
		p.belowTmin = p.belowTmin ? t('explain.belowTmin') : '';
		for (const k of ['tLast', 'tmin']) p[k] = num(p[k], 2);
		for (const k of ['cr']) p[k] = num(p[k], 3);
		for (const k of ['rlAtLast', 'since', 'rl']) p[k] = num(p[k], 1);
	}
	if (code === 'pof_below_tmin') { p.tMeasuredMin = num(p.tMeasuredMin, 2); p.tmin = num(p.tmin, 2); }
	if (code === 'pof_default') p.reasonTxt = t(`explain.reason_${p.reason}`);
	if (code === 'pof_from_rl') p.rl = num(p.rl, 1);
	if (code === 'interval_cap_rl') p.rlAtLast = num(p.rlAtLast, 1);
	if (code === 'due_date') p.status = t(`sched.${p.status}`);
	if (code === 'tmin_missing') {
		p.hint = (p.missing || []).some((m) => m.startsWith('allowableStress')) ? t('explain.tmin_missing_hint') : '';
		p.missing = (p.missing || []).join(', ');
	}
	if (code === 'grade_deviation') p.deviation = num(p.deviation * 100, 1);
	if (code === 'below_tmin') { p.tLast = num(p.tLast, 2); p.tmin = num(p.tmin, 2); }
	if (code === 'rl_under_2' || code === 'rl_under_5') p.rl = num(p.rl, 1);
	for (const k of ['s', 'e', 'p']) if (k in p && p[k] === null) p[k] = '—';
	return t(`explain.${code}`, p);
}
const items = computed(() => props.lines.map((l, i) => ({ i, text: render(l), code: l.code, gov: l.code === 'corrosion_cml' && l.params.governing })));
const warn = (c) => ['tmin_missing', 'consequence_default', 'no_base_date', 'mod_overdue', 'mod_open_anomaly', 'pof_default', 'pof_below_tmin', 'cml_no_reference'].includes(c);
</script>

<template>
	<ol class="explain mb-0">
		<li v-for="l in items" :key="l.i" :class="{ warn: warn(l.code), gov: l.gov }">{{ l.text }}</li>
	</ol>
</template>

<style scoped>
.explain { padding-left: 1.4rem; font-size: 0.86rem; }
.explain li { margin-bottom: 0.3rem; }
.explain li.warn { color: #9a4a00; }
.explain li.gov { font-weight: 600; }
</style>
