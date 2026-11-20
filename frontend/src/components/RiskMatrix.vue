<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
	matrix: { type: Array, required: true }, // 5×5 : ligne = PoF 1..5, colonne = CoF 1..5
	counts: { type: Object, default: () => ({}) }, // { "pof-cof": n }
	selected: { type: Object, default: null }, // { pof, cof }
	editable: Boolean,
});
const emit = defineEmits(['select', 'toggle']);
const { t } = useI18n();
const rows = computed(() => [5, 4, 3, 2, 1]); // PoF 5 en haut
const cols = [1, 2, 3, 4, 5];
const level = (pof, cof) => props.matrix[pof - 1][cof - 1];
const count = (pof, cof) => props.counts[`${pof}-${cof}`] || 0;
const isSel = (pof, cof) => props.selected && props.selected.pof === pof && props.selected.cof === cof;
const click = (pof, cof) => (props.editable ? emit('toggle', { pof, cof }) : emit('select', { pof, cof }));
</script>

<template>
	<div class="matrix-wrap">
		<div class="matrix-axis-y">{{ t('risk.pof') }}</div>
		<div>
			<div class="matrix-grid">
				<template v-for="pof in rows" :key="pof">
					<div class="matrix-label">{{ pof }}</div>
					<button v-for="cof in cols" :key="cof" type="button" class="matrix-cell" :class="[`risk-${level(pof, cof)}`, { sel: isSel(pof, cof), zero: !editable && !count(pof, cof) }]"
						:title="`${t('risk.pof')} ${pof} × ${t('risk.cof')} ${cof} — ${t('risk.' + level(pof, cof))}`" @click="click(pof, cof)">
						<span v-if="editable">{{ level(pof, cof) }}</span>
						<span v-else>{{ count(pof, cof) || '' }}</span>
					</button>
				</template>
				<div></div>
				<div v-for="cof in cols" :key="'c' + cof" class="matrix-label">{{ cof }}</div>
			</div>
			<div class="matrix-axis-x">{{ t('risk.cof') }}</div>
		</div>
	</div>
</template>

<style scoped>
.matrix-wrap { display: flex; gap: 0.5rem; align-items: center; }
.matrix-axis-y { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.75rem; font-weight: 600; color: #5b7285; text-align: center; }
.matrix-axis-x { text-align: center; font-size: 0.75rem; font-weight: 600; color: #5b7285; margin-top: 0.2rem; }
.matrix-grid { display: grid; grid-template-columns: 1.4rem repeat(5, minmax(46px, 64px)); gap: 3px; }
.matrix-label { display: flex; align-items: center; justify-content: center; font-size: 0.78rem; color: #5b7285; font-weight: 600; }
.matrix-cell { height: 46px; border: 2px solid transparent; border-radius: 6px; font-weight: 700; font-size: 1rem; cursor: pointer; color: #fff; }
.matrix-cell.sel { border-color: #0b2a45; box-shadow: 0 0 0 2px #fff inset; }
.matrix-cell.zero { opacity: 0.55; }
.matrix-cell:hover { filter: brightness(1.08); }
</style>
