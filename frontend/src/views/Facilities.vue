<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import Modal from '@/components/Modal.vue';

const { t } = useI18n();
const toast = useToast();
const modal = ref(null); // { kind: 'facility'|'system', id?, facilityId?, code, name, type }

onMounted(() => lookups.load(true));
const open = (kind, o = {}) => (modal.value = { kind, id: o.id, facilityId: o.facilityId, code: o.code ?? '', name: o.name ?? '', type: o.type ?? '' });

async function save() {
	const m = modal.value;
	try {
		if (m.kind === 'facility') await api(m.id ? `/facilities/${m.id}` : '/facilities', { method: m.id ? 'PUT' : 'POST', body: { code: m.code, name: m.name, type: m.type } });
		else await api(m.id ? `/systems/${m.id}` : '/systems', { method: m.id ? 'PUT' : 'POST', body: { facilityId: m.facilityId, code: m.code, name: m.name } });
		modal.value = null; toast.success(t('common.saved')); await lookups.load(true);
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function removeSystem(s) {
	if (!confirm(t('facilities.deleteSystem'))) return;
	try { await api(`/systems/${s.id}`, { method: 'DELETE' }); await lookups.load(true); } catch (e) { toast.error(e.message); }
}
</script>

<template>
	<div class="d-flex align-items-center mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('facilities.title') }}</h1>
		<button v-if="auth.user.isAdmin" class="btn btn-primary btn-sm" @click="open('facility')"><i class="fa-solid fa-plus me-1"></i>{{ t('facilities.newFacility') }}</button>
	</div>
	<div v-for="f in lookups.facilities" :key="f.id" class="card-is mb-3">
		<div class="p-3 d-flex align-items-center gap-2 border-bottom">
			<strong>{{ f.name }}</strong><span class="badge badge-class">{{ f.code }}</span><span class="text-muted small">{{ f.type }}</span>
			<div class="ms-auto d-flex gap-2">
				<button v-if="auth.user.isAdmin" class="btn btn-sm btn-outline-secondary" @click="open('facility', f)"><i class="fa-solid fa-pen"></i></button>
				<button v-if="auth.can(f.id, 'engineer')" class="btn btn-sm btn-outline-primary" @click="open('system', { facilityId: f.id })"><i class="fa-solid fa-plus me-1"></i>{{ t('facilities.newSystem') }}</button>
			</div>
		</div>
		<table class="table table-sm table-is mb-0">
			<thead><tr><th>{{ t('facilities.code') }}</th><th>{{ t('facilities.name') }}</th><th>{{ t('facilities.assets') }}</th><th></th></tr></thead>
			<tbody>
				<tr v-for="s in lookups.systems.filter((x) => x.facilityId === f.id)" :key="s.id">
					<td class="fw-semibold">{{ s.code }}</td><td>{{ s.name }}</td><td>{{ s.assets }}</td>
					<td class="text-end text-nowrap">
						<template v-if="auth.can(f.id, 'engineer')">
							<button class="btn btn-sm btn-light" @click="open('system', s)"><i class="fa-solid fa-pen"></i></button>
							<button class="btn btn-sm btn-light text-danger" @click="removeSystem(s)"><i class="fa-solid fa-trash"></i></button>
						</template>
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<Modal v-if="modal" :title="modal.kind === 'facility' ? t('facilities.newFacility') : t('facilities.newSystem')" @close="modal = null">
		<form id="facform" class="row g-3" @submit.prevent="save">
			<div class="col-md-4"><label class="form-label">{{ t('facilities.code') }}</label><input v-model="modal.code" class="form-control" maxlength="30" required /></div>
			<div class="col-md-8"><label class="form-label">{{ t('facilities.name') }}</label><input v-model="modal.name" class="form-control" maxlength="150" required /></div>
			<div v-if="modal.kind === 'facility'" class="col-12"><label class="form-label">{{ t('facilities.type') }}</label><input v-model="modal.type" class="form-control" maxlength="100" /></div>
		</form>
		<template #footer><button class="btn btn-light" @click="modal = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="facform" type="submit">{{ t('common.save') }}</button></template>
	</Modal>
</template>
