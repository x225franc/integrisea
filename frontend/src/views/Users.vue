<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { lookups } from '@/stores/lookups';
import Modal from '@/components/Modal.vue';

const { t } = useI18n();
const toast = useToast();
const users = ref([]);
const m = ref(null);

const load = async () => { await lookups.load(); users.value = await api('/users'); };
onMounted(load);

const open = (u) => (m.value = u
	? { id: u.id, email: u.email, fullName: u.fullName, password: '', isAdmin: u.isAdmin, isActive: u.isActive, locale: u.locale, facilityRoles: u.facilityRoles.map((r) => ({ ...r })) }
	: { email: '', fullName: '', password: '', isAdmin: false, isActive: true, locale: 'fr', facilityRoles: [] });
const addRight = () => {
	const free = lookups.facilities.find((f) => !m.value.facilityRoles.some((r) => r.facilityId === f.id));
	if (free) m.value.facilityRoles.push({ facilityId: free.id, role: 'reader' });
};

async function save() {
	const b = { fullName: m.value.fullName, isAdmin: m.value.isAdmin, locale: m.value.locale, facilityRoles: m.value.facilityRoles };
	if (m.value.password) b.password = m.value.password;
	try {
		if (m.value.id) await api(`/users/${m.value.id}`, { method: 'PUT', body: { ...b, isActive: m.value.isActive } });
		else await api('/users', { method: 'POST', body: { ...b, email: m.value.email } });
		m.value = null; toast.success(t('common.saved')); load();
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
const facName = (id) => lookups.facilities.find((f) => f.id === id)?.code ?? id;
</script>

<template>
	<div class="d-flex align-items-center mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('users.title') }}</h1>
		<button class="btn btn-primary btn-sm" @click="open()"><i class="fa-solid fa-plus me-1"></i>{{ t('users.new') }}</button>
	</div>
	<div class="card-is table-responsive">
		<table class="table table-hover table-is align-middle mb-0">
			<thead><tr><th>{{ t('users.fullName') }}</th><th>{{ t('users.email') }}</th><th>{{ t('users.role') }}</th><th>{{ t('users.rights') }}</th><th>{{ t('users.lastLogin') }}</th><th></th></tr></thead>
			<tbody>
				<tr v-for="u in users" :key="u.id" :class="{ 'text-muted': !u.isActive }">
					<td>{{ u.fullName }} <span v-if="!u.isActive" class="badge badge-arch">off</span></td><td>{{ u.email }}</td>
					<td><span v-if="u.isAdmin" class="badge text-bg-dark">{{ t('roles.admin') }}</span></td>
					<td><span v-for="r in u.facilityRoles" :key="r.facilityId" class="badge badge-class me-1">{{ facName(r.facilityId) }} · {{ t('roles.' + r.role) }}</span></td>
					<td class="small">{{ u.lastLoginAt?.slice(0, 16) || t('users.never') }}</td>
					<td class="text-end"><button class="btn btn-sm btn-light" @click="open(u)"><i class="fa-solid fa-pen"></i></button></td>
				</tr>
			</tbody>
		</table>
	</div>

	<Modal v-if="m" :title="m.id ? m.email : t('users.new')" wide @close="m = null">
		<form id="userform" class="row g-3" @submit.prevent="save">
			<div class="col-md-6"><label class="form-label">{{ t('users.email') }}</label><input v-model="m.email" type="email" class="form-control" :disabled="!!m.id" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('users.fullName') }}</label><input v-model="m.fullName" class="form-control" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('users.password') }}</label><input v-model="m.password" type="password" class="form-control" minlength="10" autocomplete="new-password" :required="!m.id" /></div>
			<div class="col-md-3"><label class="form-label">{{ t('users.locale') }}</label><select v-model="m.locale" class="form-select"><option value="fr">Français</option><option value="en">English</option></select></div>
			<div class="col-md-3 pt-md-4">
				<div class="form-check"><input id="adm" v-model="m.isAdmin" type="checkbox" class="form-check-input" /><label for="adm" class="form-check-label">{{ t('users.admin') }}</label></div>
				<div v-if="m.id" class="form-check"><input id="act" v-model="m.isActive" type="checkbox" class="form-check-input" /><label for="act" class="form-check-label">{{ t('users.active') }}</label></div>
			</div>
			<div v-if="!m.isAdmin" class="col-12">
				<div class="form-label">{{ t('users.rights') }}</div>
				<div v-for="(r, i) in m.facilityRoles" :key="i" class="d-flex gap-2 mb-2">
					<select v-model="r.facilityId" class="form-select"><option v-for="f in lookups.facilities" :key="f.id" :value="f.id">{{ f.name }}</option></select>
					<select v-model="r.role" class="form-select" style="max-width: 220px"><option v-for="k in ['reader', 'inspector', 'engineer']" :key="k" :value="k">{{ t('roles.' + k) }}</option></select>
					<button type="button" class="btn btn-light text-danger" @click="m.facilityRoles.splice(i, 1)"><i class="fa-solid fa-xmark"></i></button>
				</div>
				<button type="button" class="btn btn-sm btn-outline-secondary" @click="addRight">{{ t('users.addRight') }}</button>
			</div>
		</form>
		<template #footer><button class="btn btn-light" @click="m = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="userform" type="submit">{{ t('common.save') }}</button></template>
	</Modal>
</template>
