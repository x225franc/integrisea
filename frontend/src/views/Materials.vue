<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import Modal from '@/components/Modal.vue';
import ExportMenu from '@/components/ExportMenu.vue';

const { t } = useI18n();
const toast = useToast();
const parts = ref([]);
const q = ref('');
const lowOnly = ref(false);
const m = ref(null);
const detail = ref(null);
let timer;

const canEdit = computed(() => auth.user.isAdmin || auth.canAny('engineer'));
const lowCount = computed(() => parts.value.filter((p) => p.lowStock).length);
const query = computed(() => ({ q: q.value, low: lowOnly.value ? 1 : '' }));
const load = async () => { parts.value = await api('/materials/parts', { query: query.value }); };
onMounted(load);
watch(lowOnly, load);
watch(q, () => { clearTimeout(timer); timer = setTimeout(load, 300); });

const open = (p) => (m.value = p ? { ...p } : { code: '', description: '', category: '', criticality: 'Medium', stock: 0, minStock: 0 });
async function save() {
	const b = { ...m.value, stock: Number(m.value.stock), minStock: Number(m.value.minStock) };
	try { await api(b.id ? `/materials/parts/${b.id}` : '/materials/parts', { method: b.id ? 'PUT' : 'POST', body: b }); m.value = null; toast.success(t('common.saved')); load(); }
	catch (e) { toast.error(e.status === 409 ? e.message : e.details?.[0]?.message || e.message); }
}
async function del(p) { if (confirm(t('common.delete') + ' ?')) { await api(`/materials/parts/${p.id}`, { method: 'DELETE' }); load(); } }
const show = async (p) => { detail.value = await api(`/materials/parts/${p.id}`); };
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('mat.title') }}</h1>
		<ExportMenu path="/materials/parts" :query="query" name="pieces" />
		<button v-if="canEdit" class="btn btn-primary btn-sm" @click="open()"><i class="fa-solid fa-plus me-1"></i>{{ t('mat.new') }}</button>
	</div>
	<div v-if="lowCount" class="alert alert-warning py-2"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ t('mat.alert', { n: lowCount }) }}</div>
	<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
		<input v-model="q" class="form-control form-control-sm" style="max-width: 240px" :placeholder="t('common.search')" />
		<div class="form-check"><input id="lw" v-model="lowOnly" type="checkbox" class="form-check-input" /><label for="lw" class="form-check-label small">{{ t('mat.lowOnly') }}</label></div>
	</div>
	<div class="card-is table-responsive">
		<table class="table table-hover table-is mb-0">
			<thead><tr><th>{{ t('mat.code') }}</th><th>{{ t('mat.description') }}</th><th>{{ t('mat.category') }}</th><th>{{ t('mat.criticality') }}</th><th class="text-end">{{ t('mat.stock') }}</th><th class="text-end">{{ t('mat.min') }}</th><th>{{ t('mat.assets') }}</th><th></th></tr></thead>
			<tbody>
				<tr v-if="!parts.length"><td colspan="8" class="text-center text-muted py-4">{{ t('common.empty') }}</td></tr>
				<tr v-for="p in parts" :key="p.id" class="clickable" :class="{ 'table-warning': p.lowStock }" @click="show(p)">
					<td class="fw-semibold">{{ p.code }}</td><td>{{ p.description }}</td><td>{{ p.category }}</td>
					<td><span class="badge" :class="p.criticality === 'High' ? 'text-bg-danger' : p.criticality === 'Medium' ? 'text-bg-warning' : 'text-bg-secondary'">{{ t('mat.' + p.criticality) }}</span></td>
					<td class="text-end fw-semibold" :class="{ 'text-danger': p.lowStock }">{{ p.stock }}</td><td class="text-end">{{ p.minStock }}</td><td>{{ p.assets }}</td>
					<td class="text-end text-nowrap" @click.stop><template v-if="canEdit"><button class="btn btn-sm btn-light" @click="open(p)"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-light text-danger" @click="del(p)"><i class="fa-solid fa-trash"></i></button></template></td>
				</tr>
			</tbody>
		</table>
	</div>

	<Modal v-if="detail" :title="`${detail.code} — ${detail.description}`" @close="detail = null">
		<h2 class="h6">{{ t('mat.assets') }}</h2>
		<p v-if="!detail.tags.length" class="text-muted small">{{ t('mat.noParts') }}</p>
		<router-link v-for="a in detail.tags" :key="a.assetId" :to="`/assets/${a.assetId}`" class="badge badge-class me-1 text-decoration-none" @click="detail = null">{{ a.tag }} × {{ a.quantity }}</router-link>
	</Modal>

	<Modal v-if="m" :title="m.id ? m.code : t('mat.new')" @close="m = null">
		<form id="partform" class="row g-3" @submit.prevent="save">
			<div class="col-md-4"><label class="form-label">{{ t('mat.code') }} *</label><input v-model="m.code" class="form-control" maxlength="40" required /></div>
			<div class="col-md-8"><label class="form-label">{{ t('mat.description') }} *</label><input v-model="m.description" class="form-control" maxlength="255" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('mat.category') }}</label><input v-model="m.category" class="form-control" /></div>
			<div class="col-md-6"><label class="form-label">{{ t('mat.criticality') }}</label><select v-model="m.criticality" class="form-select"><option v-for="c in ['High', 'Medium', 'Low']" :key="c" :value="c">{{ t('mat.' + c) }}</option></select></div>
			<div class="col-md-6"><label class="form-label">{{ t('mat.stock') }}</label><input v-model="m.stock" type="number" min="0" class="form-control" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('mat.min') }}</label><input v-model="m.minStock" type="number" min="0" class="form-control" required /></div>
		</form>
		<template #footer><button class="btn btn-light" @click="m = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="partform" type="submit">{{ t('common.save') }}</button></template>
	</Modal>
</template>
