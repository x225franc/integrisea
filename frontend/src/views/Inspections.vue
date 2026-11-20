<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, download } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import { STATUS_CLASS } from '@/utils';
import InspectionForm from '@/components/InspectionForm.vue';
import AnomalyForm from '@/components/AnomalyForm.vue';
import ExportMenu from '@/components/ExportMenu.vue';
import Pager from '@/components/Pager.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const tab = ref('schedule');
const status = ref(route.query.status || '');
const q = ref('');
const cls = ref('');
const schedule = ref([]);
const records = ref([]);
const total = ref(0);
const page = ref(1);
const form = ref(null); // { asset? }
const anomalyDraft = ref(null);
let timer;

const query = computed(() => ({ facility: auth.facility, q: q.value, status: tab.value === 'schedule' ? status.value : '', class: tab.value === 'schedule' ? cls.value : '' }));

async function load() {
	await lookups.load();
	if (tab.value === 'schedule') schedule.value = await api('/inspections/schedule', { query: query.value });
	else { const r = await api('/inspections', { query: { facility: auth.facility, q: q.value, page: page.value, limit: 50 } }); records.value = r.items; total.value = r.total; }
}
watch([tab, status, cls, () => auth.facility], () => { page.value = 1; load(); }, { immediate: true });
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(page, load);

const canInspect = computed(() => auth.canAny('inspector'));
const asAsset = (r) => ({ id: r.assetId, tag: r.tag, description: r.description, classCode: r.classCode, facilityId: r.facilityId });
const openAnomaly = (s) => { form.value = null; anomalyDraft.value = s; };
const report = (r) => download(`/inspections/${r.id}/report`, {}, `${r.reference}.pdf`);
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('insp.title') }}</h1>
		<ExportMenu :path="tab === 'schedule' ? '/inspections/schedule' : '/inspections'" :query="query" name="inspections" />
		<button v-if="canInspect" class="btn btn-primary btn-sm" @click="form = {}"><i class="fa-solid fa-plus me-1"></i>{{ t('insp.new') }}</button>
	</div>
	<ul class="nav nav-tabs mb-3">
		<li class="nav-item"><a class="nav-link" :class="{ active: tab === 'schedule' }" href="#" @click.prevent="tab = 'schedule'">{{ t('insp.schedule') }}</a></li>
		<li class="nav-item"><a class="nav-link" :class="{ active: tab === 'records' }" href="#" @click.prevent="tab = 'records'">{{ t('insp.records') }}</a></li>
	</ul>
	<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
		<input v-model="q" class="form-control form-control-sm" style="max-width: 220px" :placeholder="t('insp.tagSearch')" />
		<template v-if="tab === 'schedule'">
			<select v-model="status" class="form-select form-select-sm" style="max-width: 170px"><option value="">{{ t('common.status') }} : {{ t('common.all') }}</option><option v-for="s in ['overdue', 'due_soon', 'planned']" :key="s" :value="s">{{ t('sched.' + s) }}</option></select>
			<select v-model="cls" class="form-select form-select-sm" style="max-width: 170px"><option value="">{{ t('assets.class') }}</option><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select>
		</template>
	</div>

	<div v-if="tab === 'schedule'" class="card-is table-responsive">
		<table class="table table-hover table-is mb-0">
			<thead><tr><th>{{ t('assets.tag') }}</th><th>{{ t('assets.class') }}</th><th>{{ t('risk.risk') }}</th><th>{{ t('rbi.due') }}</th><th>{{ t('common.status') }}</th><th>{{ t('rbi.interval') }}</th><th></th></tr></thead>
			<tbody>
				<tr v-if="!schedule.length"><td colspan="7" class="text-center text-muted py-4">{{ t('common.empty') }}</td></tr>
				<tr v-for="s in schedule" :key="s.assetId">
					<td><router-link :to="`/assets/${s.assetId}`" class="tag-link">{{ s.tag }}</router-link><br /><small class="text-muted">{{ s.description }}</small></td>
					<td><span class="badge badge-class">{{ s.classCode }}</span></td>
					<td><span class="risk-badge" :class="`risk-${s.risk}`">{{ s.risk }}</span></td>
					<td>{{ s.dueDate || t('common.none') }}<br /><small v-if="s.daysToDue != null" class="text-muted">{{ s.daysToDue < 0 ? t('sched.daysLate', { n: -s.daysToDue }) : t('sched.days', { n: s.daysToDue }) }}</small></td>
					<td><span class="badge" :class="STATUS_CLASS[s.status]">{{ t('sched.' + s.status) }}</span></td>
					<td>{{ s.intervalMonths }}</td>
					<td class="text-end"><button v-if="auth.can(s.facilityId, 'inspector')" class="btn btn-sm btn-outline-primary" @click="form = { asset: asAsset(s) }"><i class="fa-solid fa-clipboard-check me-1"></i>{{ t('insp.new') }}</button></td>
				</tr>
			</tbody>
		</table>
	</div>

	<div v-else class="card-is">
		<div class="table-responsive">
			<table class="table table-hover table-is mb-0">
				<thead><tr><th>{{ t('insp.reference') }}</th><th>{{ t('assets.tag') }}</th><th>{{ t('insp.template') }}</th><th>{{ t('common.date') }}</th><th>{{ t('insp.inspector') }}</th><th>{{ t('insp.grade') }}</th><th>{{ t('insp.minThickness') }}</th><th></th></tr></thead>
				<tbody>
					<tr v-if="!records.length"><td colspan="8" class="text-center text-muted py-4">{{ t('insp.none') }}</td></tr>
					<tr v-for="r in records" :key="r.id">
						<td class="fw-semibold">{{ r.reference }}</td>
						<td><router-link :to="`/assets/${r.assetId}`" class="tag-link">{{ r.tag }}</router-link></td>
						<td>{{ r.templateName }}</td><td>{{ r.performedOn }}</td><td>{{ r.inspector }}</td>
						<td><span v-if="r.grade" class="badge" :class="r.grade >= 3 ? 'text-bg-danger' : r.grade === 2 ? 'text-bg-warning' : 'text-bg-success'">{{ r.grade }}</span><span v-else>{{ t('common.none') }}</span></td>
						<td>{{ r.minThickness ?? t('common.none') }}</td>
						<td class="text-end"><button class="btn btn-sm btn-light" :title="t('insp.report')" @click="report(r)"><i class="fa-solid fa-file-pdf"></i></button></td>
					</tr>
				</tbody>
			</table>
		</div>
		<Pager v-model:page="page" :total="total" :limit="50" />
	</div>

	<InspectionForm v-if="form" :asset="form.asset" @close="form = null; load()" @saved="load" @suggest="openAnomaly" />
	<AnomalyForm v-if="anomalyDraft" :draft="anomalyDraft" @close="anomalyDraft = null" @saved="anomalyDraft = null; router.push('/anomalies')" />
</template>
