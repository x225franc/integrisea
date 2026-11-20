<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { settings } from '@/stores/settings';
import { num, PRIORITY_CLASS } from '@/utils';
import RiskMatrix from '@/components/RiskMatrix.vue';

const { t } = useI18n();
const router = useRouter();
const d = ref(null);
const q = ref('');
let timer;
onMounted(() => settings.load().catch(() => {}));
const matrixProvisional = computed(() => settings.data?._meta?.provisional?.includes('matrix'));

async function load() { d.value = await api('/rbi/dashboard', { query: { facility: auth.facility, q: q.value } }); }
watch(() => auth.facility, load, { immediate: true });
watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 300); });

const go = (query) => router.push({ path: '/rbi', query });
const toCell = ({ pof, cof }) => go({ pof, cof, facility: auth.facility || undefined });
const repairClass = (s) => (s === 'expired' ? 'text-bg-danger' : s === 'expiring' ? 'text-bg-warning' : 'text-bg-success');
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('nav.dashboard') }}</h1>
		<input v-model="q" class="form-control form-control-sm" style="max-width: 240px" :placeholder="t('dash.search')" />
	</div>

	<div v-if="d">
		<div v-if="d.kpis.notCalculable" class="alert alert-warning py-2">{{ t('dash.warnNotCalc', { n: d.kpis.notCalculable }) }}</div>
		<div class="row g-3 mb-3">
			<div v-for="k in [
				{ l: 'kpiAssets', v: d.kpis.assets, to: { path: '/assets' } },
				{ l: 'kpiCriticalA', v: d.kpis.criticalA, to: { path: '/rbi', query: { criticality: 'A' } } },
				{ l: 'kpiOverdue', v: d.kpis.overdue, to: { path: '/inspections', query: { status: 'overdue' } }, cls: 'text-danger' },
				{ l: 'kpiDue', v: d.kpis.dueSoon, to: { path: '/inspections', query: { status: 'due_soon' } }, cls: 'text-warning' },
				{ l: 'kpiAnomalies', v: d.kpis.openAnomalies, to: { path: '/anomalies' }, sub: `${t('dash.kpiP1P2')} : ${d.kpis.p1p2}` },
				{ l: 'kpiHigh', v: d.kpis.highRisk, to: { path: '/rbi', query: { risk: 'H' } }, cls: 'text-danger' },
			]" :key="k.l" class="col-6 col-md-4 col-xl-2">
				<div class="card-is kpi kpi-click h-100" @click="router.push(k.to)">
					<div class="text-muted small">{{ t('dash.' + k.l) }}</div>
					<div class="v" :class="k.cls">{{ k.v }}</div>
					<div v-if="k.sub" class="small text-muted">{{ k.sub }}</div>
				</div>
			</div>
		</div>

		<div class="row g-3 mb-3">
			<div class="col-lg-6">
				<div class="card-is p-3 h-100">
					<h2 class="h6">{{ t('dash.matrix') }}</h2>
					<p class="text-muted small mb-2">{{ t('dash.matrixHint') }}</p>
					<div v-if="matrixProvisional" class="small mb-2"><span class="badge text-bg-warning me-1"><i class="fa-solid fa-flask me-1"></i>{{ t('prov.badge') }}</span>{{ t('prov.matrix') }}</div>
					<RiskMatrix :matrix="d.matrix" :counts="d.counts" @select="toCell" />
				</div>
			</div>
			<div class="col-lg-3">
				<div class="card-is p-3 h-100">
					<h2 class="h6">{{ t('dash.anomalies') }}</h2>
					<div v-for="p in ['P1', 'P2', 'P3', 'P4']" :key="p" class="d-flex justify-content-between align-items-center mb-2 kpi-click" @click="router.push({ path: '/anomalies', query: { priority: p } })">
						<span class="badge" :class="PRIORITY_CLASS[p]">{{ p }}</span><strong>{{ d.anomaliesByPriority[p] }}</strong>
					</div>
				</div>
			</div>
			<div class="col-lg-3">
				<div class="card-is p-3 h-100">
					<h2 class="h6">{{ t('dash.repairs') }}</h2>
					<p v-if="!d.repairs.length" class="text-muted small mb-0">{{ t('dash.noRepairs') }}</p>
					<div v-for="r in d.repairs" :key="r.id" class="mb-2 small">
						<router-link :to="{ path: '/anomalies', query: { q: r.tag } }" class="tag-link">{{ r.tag }}</router-link> <span class="text-muted">{{ r.type }}</span><br />
						<span class="badge" :class="repairClass(r.status)">{{ t('dash.expires', { d: r.expiresOn }) }}</span>
					</div>
				</div>
			</div>
		</div>

		<div class="row g-3">
			<div class="col-lg-6">
				<div class="card-is h-100">
					<h2 class="h6 p-3 pb-0">{{ t('dash.lowestLife') }}</h2>
					<table class="table table-sm table-is mb-0"><tbody>
						<tr v-for="a in d.lowestLife" :key="a.assetId"><td><router-link :to="`/assets/${a.assetId}`" class="tag-link">{{ a.tag }}</router-link></td><td class="text-muted small">{{ a.description }}</td><td class="text-end">{{ t('dash.years', { n: num(a.remainingLife, 1) }) }}</td><td><span class="risk-badge" :class="`risk-${a.risk}`">{{ a.risk }}</span></td></tr>
					</tbody></table>
				</div>
			</div>
			<div class="col-lg-6">
				<div class="card-is h-100">
					<h2 class="h6 p-3 pb-0">{{ t('dash.next') }}</h2>
					<table class="table table-sm table-is mb-0"><tbody>
						<tr v-for="a in d.nextInspections" :key="a.assetId"><td><router-link :to="`/assets/${a.assetId}`" class="tag-link">{{ a.tag }}</router-link></td><td class="text-muted small">{{ a.description }}</td><td>{{ a.dueDate }}</td><td><span class="badge" :class="{ 'text-bg-danger': a.status === 'overdue', 'text-bg-warning': a.status === 'due_soon', 'text-bg-success': a.status === 'planned' }">{{ t('sched.' + a.status) }}</span></td></tr>
					</tbody></table>
				</div>
			</div>
		</div>
	</div>
</template>
