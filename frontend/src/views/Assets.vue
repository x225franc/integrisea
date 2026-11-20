<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, download } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import AssetForm from '@/components/AssetForm.vue';
import ImportModal from '@/components/ImportModal.vue';

const { t, locale } = useI18n();
const router = useRouter();
const items = ref([]);
const total = ref(0);
const page = ref(1);
const limit = 50;
const q = ref('');
const cls = ref('');
const system = ref('');
const archived = ref(false);
const discipline = ref('');
const loading = ref(false);
const showForm = ref(false);
const showImport = ref(false);
let timer;

const systemsList = computed(() => lookups.systems.filter((s) => !auth.facility || s.facilityId === Number(auth.facility)));
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

async function load() {
	loading.value = true;
	try {
		await lookups.load();
		const r = await api('/assets', { query: { q: q.value, facility: auth.facility, system: system.value, class: cls.value, discipline: discipline.value, archived: archived.value ? '1' : '0', page: page.value, limit } });
		items.value = r.items; total.value = r.total;
	} finally { loading.value = false; }
}
watch([cls, discipline, system, archived, () => auth.facility], () => { page.value = 1; if (!systemsList.value.some((s) => s.id === system.value)) system.value = ''; load(); }, { immediate: true });
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(page, load);

const exportFile = (format) => download('/assets/export', { format, facility: auth.facility }, `assets.${format}`);
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('assets.title') }} <small class="text-muted fs-6">{{ t('assets.total', { n: total }) }}</small></h1>
		<div class="dropdown">
			<button class="btn btn-outline-secondary btn-sm dropdown-toggle" data-bs-toggle="dropdown"><i class="fa-solid fa-download me-1"></i>{{ t('assets.export') }}</button>
			<ul class="dropdown-menu"><li><a class="dropdown-item" href="#" @click.prevent="exportFile('xlsx')">Excel (.xlsx)</a></li><li><a class="dropdown-item" href="#" @click.prevent="exportFile('csv')">CSV</a></li></ul>
		</div>
		<template v-if="auth.canAny('engineer')">
			<button class="btn btn-outline-secondary btn-sm" @click="showImport = true"><i class="fa-solid fa-upload me-1"></i>{{ t('assets.import') }}</button>
			<button class="btn btn-primary btn-sm" @click="showForm = true"><i class="fa-solid fa-plus me-1"></i>{{ t('assets.new') }}</button>
		</template>
	</div>

	<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
		<input v-model="q" class="form-control form-control-sm" style="max-width: 260px" :placeholder="t('common.search')" />
		<select v-model="cls" class="form-select form-select-sm" style="max-width: 200px">
			<option value="">{{ t('assets.class') }} : {{ t('common.all') }}</option>
			<option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }} — {{ lookups.className(c.code, locale) }}</option>
		</select>
		<select v-model="discipline" class="form-select form-select-sm" style="max-width: 200px">
			<option value="">{{ t('assets.discipline') }} : {{ t('common.all') }}</option>
			<option v-for="d in lookups.disciplines" :key="d" :value="d">{{ d }}</option>
		</select>
		<select v-model="system" class="form-select form-select-sm" style="max-width: 240px">
			<option value="">{{ t('assets.system') }} : {{ t('common.all') }}</option>
			<option v-for="s in systemsList" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
		</select>
		<div class="form-check ms-2"><input id="arch" v-model="archived" type="checkbox" class="form-check-input" /><label for="arch" class="form-check-label">{{ t('assets.showArchived') }}</label></div>
	</div>

	<div class="card-is">
		<div class="table-responsive">
			<table class="table table-hover table-is align-middle mb-0">
				<thead><tr><th>{{ t('assets.tag') }}</th><th>{{ t('assets.description') }}</th><th>{{ t('assets.class') }}</th><th>{{ t('assets.discipline') }}</th><th>{{ t('assets.system') }}</th><th>{{ t('assets.fluid') }}</th><th>{{ t('assets.material') }}</th><th>{{ t('assets.installYear') }}</th></tr></thead>
				<tbody>
					<tr v-if="!loading && !items.length"><td colspan="8" class="text-center text-muted py-4">{{ t('common.empty') }}</td></tr>
					<tr v-for="a in items" :key="a.id" class="clickable" @click="router.push(`/assets/${a.id}`)">
						<td class="fw-semibold">{{ a.tag }} <span v-if="a.archivedAt" class="badge badge-arch">{{ t('assets.archived') }}</span></td>
						<td>{{ a.description }}</td>
						<td><span class="badge badge-class">{{ a.classCode }}</span></td>
						<td class="small">{{ a.discipline || t('common.none') }}</td>
						<td>{{ a.systemCode }}</td><td>{{ a.fluid || t('common.none') }}</td><td>{{ a.material || t('common.none') }}</td><td>{{ a.installYear || t('common.none') }}</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div v-if="pages > 1" class="d-flex justify-content-center align-items-center gap-2 p-2 border-top">
			<button class="btn btn-sm btn-light" :disabled="page <= 1" @click="page--"><i class="fa-solid fa-chevron-left"></i></button>
			<span class="small">{{ t('common.page') }} {{ page }} {{ t('common.of') }} {{ pages }}</span>
			<button class="btn btn-sm btn-light" :disabled="page >= pages" @click="page++"><i class="fa-solid fa-chevron-right"></i></button>
		</div>
	</div>

	<AssetForm v-if="showForm" @close="showForm = false" @saved="(a) => router.push(`/assets/${a.id}`)" />
	<ImportModal v-if="showImport" @close="showImport = false" @done="load" />
</template>
