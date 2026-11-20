<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import { num, STATUS_CLASS } from '@/utils';
import RiskMatrix from '@/components/RiskMatrix.vue';
import ExportMenu from '@/components/ExportMenu.vue';
import Pager from '@/components/Pager.vue';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const items = ref([]);
const total = ref(0);
const page = ref(1);
const mx = ref(null);
const q = ref(route.query.q || '');
const cls = ref(route.query.class || '');
const risk = ref(route.query.risk || '');
const criticality = ref(route.query.criticality || '');
const status = ref(route.query.status || '');
const cell = ref(route.query.pof ? { pof: Number(route.query.pof), cof: Number(route.query.cof) } : null);
const notCalc = ref(false);
let timer;

const query = computed(() => ({ facility: auth.facility, q: q.value, class: cls.value, risk: risk.value, criticality: criticality.value, status: status.value, pof: cell.value?.pof, cof: cell.value?.cof, notCalculable: notCalc.value ? 1 : '' }));

async function load() {
	await lookups.load();
	const [list, m] = await Promise.all([
		api('/rbi/assets', { query: { ...query.value, page: page.value, limit: 50 } }),
		api('/rbi/matrix', { query: { facility: auth.facility, q: q.value } }),
	]);
	items.value = list.items; total.value = list.total; mx.value = m;
}
watch([cls, risk, criticality, status, cell, notCalc, () => auth.facility], () => { page.value = 1; load(); }, { immediate: true });
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(page, load);
const pick = (c) => { cell.value = cell.value && cell.value.pof === c.pof && cell.value.cof === c.cof ? null : c; };
const reset = () => { q.value = cls.value = risk.value = criticality.value = status.value = ''; cell.value = null; notCalc.value = false; router.replace({ query: {} }); };
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('rbi.title') }} <small class="text-muted fs-6">{{ t('common.total', { n: total }) }}</small></h1>
		<ExportMenu path="/rbi/assets" :query="query" name="rbi" />
	</div>

	<div class="row g-3">
		<div class="col-xl-4">
			<div class="card-is p-3">
				<h2 class="h6">{{ t('dash.matrix') }}</h2>
				<RiskMatrix v-if="mx" :matrix="mx.matrix" :counts="mx.counts" :selected="cell" @select="pick" />
				<div v-if="cell" class="mt-2"><span class="badge text-bg-primary">{{ t('rbi.cell', cell) }}</span> <a href="#" class="small ms-1" @click.prevent="cell = null">{{ t('rbi.clearCell') }}</a></div>
			</div>
		</div>
		<div class="col-xl-8">
			<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
				<input v-model="q" class="form-control form-control-sm" style="max-width: 200px" :placeholder="t('common.search')" />
				<select v-model="cls" class="form-select form-select-sm" style="max-width: 170px"><option value="">{{ t('assets.class') }}</option><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select>
				<select v-model="risk" class="form-select form-select-sm" style="max-width: 150px"><option value="">{{ t('risk.risk') }}</option><option v-for="r in ['H', 'MH', 'M', 'L']" :key="r" :value="r">{{ t('risk.' + r) }}</option></select>
				<select v-model="criticality" class="form-select form-select-sm" style="max-width: 130px"><option value="">{{ t('risk.crit') }}</option><option v-for="c in ['A', 'B', 'C']" :key="c" :value="c">{{ c }}</option></select>
				<select v-model="status" class="form-select form-select-sm" style="max-width: 160px"><option value="">{{ t('common.status') }}</option><option v-for="s in ['overdue', 'due_soon', 'planned']" :key="s" :value="s">{{ t('sched.' + s) }}</option></select>
				<div class="form-check"><input id="nc" v-model="notCalc" type="checkbox" class="form-check-input" /><label for="nc" class="form-check-label small">{{ t('risk.notCalculable') }}</label></div>
				<button class="btn btn-sm btn-light ms-auto" @click="reset">{{ t('common.reset') }}</button>
			</div>
			<div class="card-is">
				<div class="table-responsive">
					<table class="table table-hover table-is mb-0">
						<thead><tr><th>{{ t('assets.tag') }}</th><th>{{ t('assets.class') }}</th><th>PoF</th><th>CoF</th><th>{{ t('risk.risk') }}</th><th>{{ t('risk.crit') }}</th><th>{{ t('rbi.rl') }}</th><th>{{ t('rbi.interval') }}</th><th>{{ t('rbi.due') }}</th></tr></thead>
						<tbody>
							<tr v-if="!items.length"><td colspan="9" class="text-center text-muted py-4">{{ t('common.empty') }}</td></tr>
							<tr v-for="a in items" :key="a.assetId" class="clickable" @click="router.push(`/assets/${a.assetId}`)">
								<td><span class="tag-link">{{ a.tag }}</span><br /><small class="text-muted">{{ a.description }}</small></td>
								<td><span class="badge badge-class">{{ a.classCode }}</span></td>
								<td>{{ a.pof }}</td><td>{{ a.cof }}</td>
								<td><span class="risk-badge" :class="`risk-${a.risk}`">{{ a.risk }}</span> <span v-if="!a.calculable" class="badge text-bg-warning" :title="t('risk.notCalculable')">!</span></td>
								<td>{{ a.criticality }}<i v-if="a.sce" class="fa-solid fa-shield ms-1 text-danger" :title="t('risk.sce')"></i></td>
								<td>{{ a.remainingLife != null ? num(a.remainingLife, 1) : t('common.none') }}</td>
								<td>{{ a.intervalMonths }}</td>
								<td class="text-nowrap">{{ a.dueDate || t('common.none') }} <span class="badge" :class="STATUS_CLASS[a.status]">{{ t('sched.' + a.status) }}</span></td>
							</tr>
						</tbody>
					</table>
				</div>
				<Pager v-model:page="page" :total="total" :limit="50" />
			</div>
		</div>
	</div>
</template>
