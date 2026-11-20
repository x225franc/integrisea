<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import AssetForm from '@/components/AssetForm.vue';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const a = ref(null);
const tab = ref('attributes');
const history = ref([]);
const showForm = ref(false);

const canEdit = computed(() => a.value && auth.can(a.value.facilityId, 'engineer'));
const tabs = ['attributes', 'criticality', 'inspections', 'anomalies', 'maintenance', 'spares', 'documents', 'history'];
const v = (x) => (x === null || x === undefined || x === '' ? t('common.none') : x);

async function load() {
	try { a.value = await api(`/assets/${route.params.id}`); } catch { router.replace('/assets'); return; }
	await lookups.load();
	if (auth.can(a.value.facilityId, 'engineer')) history.value = (await api('/audit', { query: { entity: 'asset', entityId: a.value.id, limit: 100 } })).items;
}
onMounted(load);

async function toggleArchive() {
	if (!a.value.archivedAt && !confirm(t('assets.archiveConfirm'))) return;
	await api(`/assets/${a.value.id}/${a.value.archivedAt ? 'restore' : 'archive'}`, { method: 'POST' });
	toast.success(t('common.saved'));
	load();
}
const fmt = (o) => (o ? JSON.stringify(o, null, 1) : '');
</script>

<template>
	<div v-if="a">
		<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
			<router-link to="/assets" class="btn btn-sm btn-light"><i class="fa-solid fa-arrow-left"></i></router-link>
			<h1 class="h4 mb-0">{{ a.tag }}</h1>
			<span class="badge badge-class">{{ a.classCode }}</span>
			<span v-if="a.archivedAt" class="badge badge-arch">{{ t('assets.archived') }}</span>
			<span class="text-muted">{{ a.description }}</span>
			<div v-if="canEdit" class="ms-auto d-flex gap-2">
				<button class="btn btn-sm btn-outline-secondary" @click="showForm = true"><i class="fa-solid fa-pen me-1"></i>{{ t('common.edit') }}</button>
				<button class="btn btn-sm btn-outline-secondary" @click="toggleArchive"><i class="fa-solid fa-box-archive me-1"></i>{{ a.archivedAt ? t('assets.restore') : t('assets.archive') }}</button>
			</div>
		</div>

		<ul class="nav nav-tabs mb-3">
			<li v-for="k in tabs" :key="k" class="nav-item" v-show="k !== 'history' || canEdit">
				<a class="nav-link" :class="{ active: tab === k }" href="#" @click.prevent="tab = k">{{ t('assets.tabs.' + k) }}</a>
			</li>
		</ul>

		<div v-if="tab === 'attributes'" class="card-is p-4">
			<dl class="attr-grid mb-0">
				<div><dt>{{ t('assets.facility') }}</dt><dd>{{ a.facilityName }}</dd></div>
				<div><dt>{{ t('assets.system') }}</dt><dd>{{ a.systemCode }} — {{ a.systemName }}</dd></div>
				<div><dt>{{ t('assets.class') }}</dt><dd>{{ lookups.className(a.classCode, locale) }}</dd></div>
				<div><dt>{{ t('assets.fluid') }}</dt><dd>{{ v(a.fluid) }}</dd></div>
				<div><dt>{{ t('assets.material') }}</dt><dd>{{ v(a.material) }}</dd></div>
				<div><dt>{{ t('assets.installYear') }}</dt><dd>{{ v(a.installYear) }}</dd></div>
				<div><dt>{{ t('assets.designPressure') }}</dt><dd>{{ v(a.designPressureBarg) }}</dd></div>
				<div><dt>{{ t('assets.designTemp') }}</dt><dd>{{ v(a.designTempC) }}</dd></div>
				<div><dt>{{ t('assets.od') }}</dt><dd>{{ v(a.odMm) }}</dd></div>
				<div><dt>{{ t('assets.nominalThickness') }}</dt><dd>{{ v(a.nominalThicknessMm) }}</dd></div>
				<div><dt>S / E / P</dt><dd>{{ v(a.crit.s) }} / {{ v(a.crit.e) }} / {{ v(a.crit.p) }}</dd></div>
				<div class="grid-span"><dt>{{ t('assets.mechanisms') }}</dt><dd><span v-for="m in a.degradationMechanisms" :key="m" class="badge text-bg-light border me-1">{{ m }}</span><span v-if="!a.degradationMechanisms.length">{{ t('common.none') }}</span></dd></div>
			</dl>
		</div>

		<div v-else-if="tab === 'history'" class="card-is">
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('audit.when') }}</th><th>{{ t('audit.who') }}</th><th>{{ t('audit.action') }}</th><th>{{ t('audit.before') }}</th><th>{{ t('audit.after') }}</th></tr></thead>
				<tbody>
					<tr v-if="!history.length"><td colspan="5" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
					<tr v-for="h in history" :key="h.id"><td class="text-nowrap">{{ h.occurredAt.slice(0, 19) }}</td><td>{{ h.userEmail }}</td><td>{{ h.action }}</td><td><pre class="json">{{ fmt(h.before) }}</pre></td><td><pre class="json">{{ fmt(h.after) }}</pre></td></tr>
				</tbody>
			</table>
		</div>

		<div v-else class="card-is p-4 text-muted">{{ t('common.comingSoon') }}</div>

		<AssetForm v-if="showForm" :asset="a" @close="showForm = false" @saved="showForm = false; load()" />
	</div>
</template>

<style scoped>.grid-span { grid-column: 1 / -1; }</style>
