<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { PRIORITY_CLASS, AN_STATUS_CLASS } from '@/utils';
import Modal from './Modal.vue';

const props = defineProps({ id: { type: Number, required: true } });
const emit = defineEmits(['close', 'changed']);
const { t } = useI18n();
const toast = useToast();

const a = ref(null);
const newAction = ref({ text: '', owner: '' });
const newRepair = ref({ type: '', installedOn: '', expiresOn: '' });
const showRepair = ref(false);

const canEngineer = computed(() => a.value && auth.can(a.value.facilityId, 'engineer'));
const canInspect = computed(() => a.value && auth.can(a.value.facilityId, 'inspector'));
const locked = computed(() => a.value?.status === 'Closed');
const openActions = computed(() => (a.value?.actions ?? []).filter((x) => !x.done).length);

async function load() { a.value = await api(`/anomalies/${props.id}`); }
onMounted(load);

async function run(fn, successMsg) {
	try { a.value = await fn(); emit('changed'); if (successMsg) toast.success(successMsg); }
	catch (e) { toast.error(e.status === 409 ? `${e.message}` : e.details?.[0]?.message || e.message); }
}
const setStatus = (status) => run(() => api(`/anomalies/${props.id}/status`, { method: 'POST', body: { status } }), t('an.updated'));
const toggle = (x) => run(() => api(`/anomalies/${props.id}/actions/${x.id}`, { method: 'PUT', body: { done: !x.done } }));
const addAction = () => run(async () => { const r = await api(`/anomalies/${props.id}/actions`, { method: 'POST', body: { text: newAction.value.text, owner: newAction.value.owner } }); newAction.value = { text: '', owner: '' }; return r; });
const delAction = (x) => run(() => api(`/anomalies/${props.id}/actions/${x.id}`, { method: 'DELETE' }));
const addRepair = () => run(async () => { const r = await api(`/anomalies/${props.id}/repairs`, { method: 'POST', body: { type: newRepair.value.type, installedOn: newRepair.value.installedOn || null, expiresOn: newRepair.value.expiresOn } }); showRepair.value = false; newRepair.value = { type: '', installedOn: '', expiresOn: '' }; return r; });
const removeRepair = (r) => run(() => api(`/anomalies/${props.id}/repairs/${r.id}`, { method: 'PUT', body: { removed: true } }));
const setPriority = (p) => run(() => api(`/anomalies/${props.id}`, { method: 'PUT', body: { priority: p } }), t('an.updated'));
</script>

<template>
	<Modal v-if="a" :title="`${a.reference} — ${a.tag}`" wide @close="emit('close')">
		<div class="d-flex flex-wrap gap-2 align-items-center mb-3">
			<span class="badge" :class="PRIORITY_CLASS[a.priority]">{{ a.priority }}</span>
			<span class="badge" :class="AN_STATUS_CLASS[a.status]">{{ t('an.' + a.status) }}</span>
			<span v-if="a.overdue" class="badge text-bg-danger">{{ t('an.overdue') }}</span>
			<router-link :to="`/assets/${a.assetId}`" class="ms-auto small" @click="emit('close')">{{ a.tag }} — {{ a.assetDescription }}</router-link>
		</div>
		<h2 class="h6">{{ a.title }}</h2>
		<p class="text-muted">{{ a.description }}</p>
		<dl class="attr-grid mb-3">
			<div><dt>{{ t('an.raised') }}</dt><dd>{{ a.raisedOn }}</dd></div>
			<div><dt>{{ t('an.due') }}</dt><dd>{{ a.dueDate }}</dd></div>
			<div><dt>{{ t('an.owner') }}</dt><dd>{{ a.owner || t('common.none') }}</dd></div>
			<div v-if="a.closedOn"><dt>{{ t('an.closed') }}</dt><dd>{{ a.closedOn }}</dd></div>
		</dl>

		<div v-if="canEngineer && !locked" class="d-flex flex-wrap gap-2 align-items-center mb-3">
			<span class="small text-muted">{{ t('an.priority') }}</span>
			<div class="btn-group btn-group-sm"><button v-for="p in ['P1', 'P2', 'P3', 'P4']" :key="p" class="btn" :class="a.priority === p ? 'btn-primary' : 'btn-outline-secondary'" @click="a.priority !== p && setPriority(p)">{{ p }}</button></div>
			<span class="small text-muted ms-3">{{ t('an.setStatus') }}</span>
			<div class="btn-group btn-group-sm">
				<button class="btn" :class="a.status === 'Open' ? 'btn-primary' : 'btn-outline-secondary'" @click="a.status !== 'Open' && setStatus('Open')">{{ t('an.Open') }}</button>
				<button class="btn" :class="a.status === 'InProgress' ? 'btn-primary' : 'btn-outline-secondary'" @click="a.status !== 'InProgress' && setStatus('InProgress')">{{ t('an.InProgress') }}</button>
				<button class="btn btn-outline-secondary" @click="setStatus('Closed')">{{ t('an.Closed') }}</button>
			</div>
		</div>
		<div v-if="canEngineer && !locked && openActions" class="small text-warning mb-2"><i class="fa-solid fa-circle-info me-1"></i>{{ t('an.closeBlocked') }} ({{ openActions }})</div>
		<div v-if="locked" class="alert alert-secondary py-2">{{ t('an.locked') }}</div>
		<div v-if="canEngineer && locked" class="mb-3"><button class="btn btn-sm btn-outline-secondary" @click="setStatus('Open')">{{ t('an.Open') }}</button></div>

		<h3 class="h6 mt-3">{{ t('an.actions') }}</h3>
		<p v-if="!a.actions.length" class="text-muted small">{{ t('an.noActions') }}</p>
		<ul class="list-group mb-2">
			<li v-for="x in a.actions" :key="x.id" class="list-group-item d-flex align-items-center gap-2">
				<input type="checkbox" class="form-check-input mt-0" :checked="x.done" :disabled="locked || !canInspect" :aria-label="t('an.done')" @change="toggle(x)" />
				<span :class="{ 'text-decoration-line-through text-muted': x.done }">{{ x.text }}</span>
				<span class="text-muted small ms-auto">{{ x.owner }}</span>
				<button v-if="canEngineer && !locked" class="btn btn-sm btn-light text-danger" @click="delAction(x)"><i class="fa-solid fa-xmark"></i></button>
			</li>
		</ul>
		<form v-if="canInspect && !locked" class="d-flex gap-2 mb-3" @submit.prevent="addAction">
			<input v-model="newAction.text" class="form-control form-control-sm" :placeholder="t('an.action')" required />
			<input v-model="newAction.owner" class="form-control form-control-sm" style="max-width: 180px" :placeholder="t('an.owner')" />
			<button class="btn btn-sm btn-outline-primary text-nowrap">{{ t('an.addAction') }}</button>
		</form>

		<h3 class="h6 mt-3">{{ t('an.repair') }}</h3>
		<p v-if="!a.repairs.length" class="text-muted small">{{ t('an.none') }}</p>
		<ul class="list-group mb-2">
			<li v-for="r in a.repairs" :key="r.id" class="list-group-item d-flex align-items-center gap-2">
				<strong>{{ r.type }}</strong><span class="text-muted small">{{ t('an.expiresOn') }} {{ r.expiresOn }}</span>
				<span v-if="r.removedOn" class="badge badge-arch">{{ t('an.remove') }} {{ r.removedOn }}</span>
				<button v-else-if="canEngineer && !locked" class="btn btn-sm btn-light ms-auto" @click="removeRepair(r)">{{ t('an.markRemoved') }}</button>
			</li>
		</ul>
		<template v-if="canEngineer && !locked">
			<button v-if="!showRepair" class="btn btn-sm btn-outline-secondary" @click="showRepair = true">{{ t('an.addRepair') }}</button>
			<form v-else class="row g-2" @submit.prevent="addRepair">
				<div class="col-md-5"><input v-model="newRepair.type" class="form-control form-control-sm" :placeholder="t('an.repairType')" required /></div>
				<div class="col-md-3"><input v-model="newRepair.installedOn" type="date" class="form-control form-control-sm" :title="t('an.installedOn')" /></div>
				<div class="col-md-3"><input v-model="newRepair.expiresOn" type="date" class="form-control form-control-sm" :title="t('an.expiresOn')" required /></div>
				<div class="col-md-1"><button class="btn btn-sm btn-primary">OK</button></div>
			</form>
		</template>
	</Modal>
</template>
