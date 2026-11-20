<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';

const { t } = useI18n();
const items = ref([]);
const total = ref(0);
const page = ref(1);
const entity = ref('');
const from = ref('');
const to = ref('');
const limit = 50;
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)));
const entities = ['asset', 'facility', 'system', 'user', 'asset_class', 'asset_attribute_def'];

async function load() {
	const r = await api('/audit', { query: { entity: entity.value, facility: auth.facility, from: from.value, to: to.value, page: page.value, limit } });
	items.value = r.items; total.value = r.total;
}
watch([entity, from, to, () => auth.facility], () => { page.value = 1; load(); }, { immediate: true });
watch(page, load);
const fmt = (o) => (o ? JSON.stringify(o, null, 1) : '');
</script>

<template>
	<h1 class="h4 mb-3">{{ t('audit.title') }} <small class="text-muted fs-6">({{ total }})</small></h1>
	<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
		<select v-model="entity" class="form-select form-select-sm" style="max-width: 200px"><option value="">{{ t('audit.entity') }} : {{ t('audit.all') }}</option><option v-for="e in entities" :key="e" :value="e">{{ e }}</option></select>
		<label class="small text-muted">{{ t('audit.from') }}</label><input v-model="from" type="date" class="form-control form-control-sm" style="max-width: 160px" />
		<label class="small text-muted">{{ t('audit.to') }}</label><input v-model="to" type="date" class="form-control form-control-sm" style="max-width: 160px" />
	</div>
	<div class="card-is table-responsive">
		<table class="table table-sm table-is align-top mb-0">
			<thead><tr><th>{{ t('audit.when') }}</th><th>{{ t('audit.who') }}</th><th>{{ t('audit.action') }}</th><th>{{ t('audit.entity') }}</th><th>{{ t('audit.before') }}</th><th>{{ t('audit.after') }}</th></tr></thead>
			<tbody>
				<tr v-if="!items.length"><td colspan="6" class="text-center text-muted py-4">{{ t('common.empty') }}</td></tr>
				<tr v-for="h in items" :key="h.id">
					<td class="text-nowrap">{{ h.occurredAt.slice(0, 19) }}</td><td>{{ h.userEmail }}</td><td><span class="badge badge-class">{{ h.action }}</span></td>
					<td>{{ h.entity }} <strong>{{ h.entityLabel }}</strong></td><td><pre class="json">{{ fmt(h.before) }}</pre></td><td><pre class="json">{{ fmt(h.after) }}</pre></td>
				</tr>
			</tbody>
		</table>
		<div v-if="pages > 1" class="d-flex justify-content-center align-items-center gap-2 p-2 border-top">
			<button class="btn btn-sm btn-light" :disabled="page <= 1" @click="page--"><i class="fa-solid fa-chevron-left"></i></button>
			<span class="small">{{ t('common.page') }} {{ page }} {{ t('common.of') }} {{ pages }}</span>
			<button class="btn btn-sm btn-light" :disabled="page >= pages" @click="page++"><i class="fa-solid fa-chevron-right"></i></button>
		</div>
	</div>
</template>
