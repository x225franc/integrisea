<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { PRIORITY_CLASS, AN_STATUS_CLASS } from '@/utils';
import AnomalyForm from '@/components/AnomalyForm.vue';
import AnomalyDialog from '@/components/AnomalyDialog.vue';
import ExportMenu from '@/components/ExportMenu.vue';
import Pager from '@/components/Pager.vue';

const { t } = useI18n();
const route = useRoute();
const tab = ref('list');
const status = ref('open');
const priority = ref(route.query.priority || '');
const q = ref(route.query.q || '');
const overdue = ref(false);
const items = ref([]);
const repairs = ref([]);
const total = ref(0);
const page = ref(1);
const showNew = ref(false);
const openId = ref(null);
let timer;

const query = computed(() => ({ status: status.value, priority: priority.value, q: q.value, facility: auth.facility, overdue: overdue.value ? 1 : '' }));
async function load() {
	if (tab.value === 'list') { const r = await api('/anomalies', { query: { ...query.value, page: page.value, limit: 50 } }); items.value = r.items; total.value = r.total; }
	else repairs.value = await api('/anomalies/repairs', { query: { facility: auth.facility } });
}
watch([tab, status, priority, overdue, () => auth.facility], () => { page.value = 1; load(); }, { immediate: true });
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(page, load);
const repairClass = (s) => (s === 'expired' ? 'text-bg-danger' : s === 'expiring' ? 'text-bg-warning' : 'text-bg-success');
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('an.title') }} <small v-if="tab === 'list'" class="text-muted fs-6">{{ t('common.total', { n: total }) }}</small></h1>
		<ExportMenu :path="tab === 'list' ? '/anomalies' : '/anomalies/repairs'" :query="tab === 'list' ? query : { facility: auth.facility }" name="anomalies" />
		<button v-if="auth.canAny('inspector')" class="btn btn-primary btn-sm" @click="showNew = true"><i class="fa-solid fa-plus me-1"></i>{{ t('an.new') }}</button>
	</div>
	<ul class="nav nav-tabs mb-3">
		<li class="nav-item"><a class="nav-link" :class="{ active: tab === 'list' }" href="#" @click.prevent="tab = 'list'">{{ t('an.list') }}</a></li>
		<li class="nav-item"><a class="nav-link" :class="{ active: tab === 'repairs' }" href="#" @click.prevent="tab = 'repairs'">{{ t('an.repairs') }}</a></li>
	</ul>

	<template v-if="tab === 'list'">
		<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
			<input v-model="q" class="form-control form-control-sm" style="max-width: 220px" :placeholder="t('common.search')" />
			<select v-model="status" class="form-select form-select-sm" style="max-width: 160px"><option value="open">{{ t('an.open') }}</option><option value="all">{{ t('an.all') }}</option><option value="Closed">{{ t('an.Closed') }}</option></select>
			<select v-model="priority" class="form-select form-select-sm" style="max-width: 140px"><option value="">{{ t('an.priority') }}</option><option v-for="p in ['P1', 'P2', 'P3', 'P4']" :key="p" :value="p">{{ p }}</option></select>
			<div class="form-check"><input id="od" v-model="overdue" type="checkbox" class="form-check-input" /><label for="od" class="form-check-label small">{{ t('an.overdue') }}</label></div>
		</div>
		<div class="card-is">
			<div class="table-responsive">
				<table class="table table-hover table-is mb-0">
					<thead><tr><th>{{ t('an.reference') }}</th><th>{{ t('an.asset') }}</th><th>{{ t('an.titleField') }}</th><th>{{ t('an.priority') }}</th><th>{{ t('an.status') }}</th><th>{{ t('an.due') }}</th></tr></thead>
					<tbody>
						<tr v-if="!items.length"><td colspan="6" class="text-center text-muted py-4">{{ t('an.none') }}</td></tr>
						<tr v-for="a in items" :key="a.id" class="clickable" @click="openId = a.id">
							<td class="fw-semibold">{{ a.reference }}</td><td>{{ a.tag }}</td><td>{{ a.title }}</td>
							<td><span class="badge" :class="PRIORITY_CLASS[a.priority]">{{ a.priority }}</span></td>
							<td><span class="badge" :class="AN_STATUS_CLASS[a.status]">{{ t('an.' + a.status) }}</span></td>
							<td class="text-nowrap" :class="{ 'text-danger fw-semibold': a.overdue }">{{ a.dueDate }}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<Pager v-model:page="page" :total="total" :limit="50" />
		</div>
	</template>

	<div v-else class="card-is table-responsive">
		<table class="table table-hover table-is mb-0">
			<thead><tr><th>{{ t('an.asset') }}</th><th>{{ t('an.reference') }}</th><th>{{ t('an.repairType') }}</th><th>{{ t('an.installedOn') }}</th><th>{{ t('an.expiresOn') }}</th><th>{{ t('common.status') }}</th></tr></thead>
			<tbody>
				<tr v-if="!repairs.length"><td colspan="6" class="text-center text-muted py-4">{{ t('dash.noRepairs') }}</td></tr>
				<tr v-for="r in repairs" :key="r.id" class="clickable" @click="openId = r.anomalyId">
					<td class="fw-semibold">{{ r.tag }}</td><td>{{ r.reference }}</td><td>{{ r.type }}</td><td>{{ r.installedOn || t('common.none') }}</td><td>{{ r.expiresOn }}</td>
					<td><span class="badge" :class="repairClass(r.status)">{{ t('an.repairStatus.' + r.status) }}</span> <small class="text-muted">{{ r.daysLeft < 0 ? '' : t('an.daysLeft', { n: r.daysLeft }) }}</small></td>
				</tr>
			</tbody>
		</table>
	</div>

	<AnomalyForm v-if="showNew" @close="showNew = false" @saved="showNew = false; load()" />
	<AnomalyDialog v-if="openId" :id="openId" @close="openId = null" @changed="load" />
</template>
