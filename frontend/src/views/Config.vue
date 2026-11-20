<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { lookups } from '@/stores/lookups';
import Modal from '@/components/Modal.vue';

const { t } = useI18n();
const toast = useToast();
const attrs = ref([]);
const cm = ref(null);
const am = ref(null);

const load = async () => { await lookups.load(true); attrs.value = await api('/attributes'); };
onMounted(load);

const openClass = (c) => (cm.value = c ? { ...c, isNew: false } : { isNew: true, code: '', nameFr: '', nameEn: '', tracking: 'condition', cfihosCode: '', isActive: true, sortOrder: 100 });
async function saveClass() {
	const c = cm.value;
	try {
		await api(c.isNew ? '/classes' : `/classes/${c.code}`, { method: c.isNew ? 'POST' : 'PUT', body: { code: c.code, nameFr: c.nameFr, nameEn: c.nameEn, tracking: c.tracking, cfihosCode: c.cfihosCode, isActive: c.isActive, sortOrder: c.sortOrder } });
		cm.value = null; toast.success(t('common.saved')); load();
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function saveAttr() {
	try {
		await api('/attributes', { method: 'POST', body: am.value });
		am.value = null; toast.success(t('common.saved')); load();
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function delAttr(a) { if (confirm(t('common.delete') + ' ?')) { await api(`/attributes/${a.id}`, { method: 'DELETE' }); load(); } }
</script>

<template>
	<h1 class="h4 mb-3">{{ t('config.title') }}</h1>
	<div class="card-is mb-4">
		<div class="p-3 d-flex border-bottom align-items-center"><strong class="me-auto">{{ t('config.classes') }}</strong><button class="btn btn-primary btn-sm" @click="openClass()"><i class="fa-solid fa-plus me-1"></i>{{ t('config.newClass') }}</button></div>
		<table class="table table-sm table-is mb-0">
			<thead><tr><th>Code</th><th>{{ t('config.nameFr') }}</th><th>{{ t('config.nameEn') }}</th><th>{{ t('config.tracking') }}</th><th>{{ t('config.cfihos') }}</th><th>{{ t('config.active') }}</th><th></th></tr></thead>
			<tbody><tr v-for="c in lookups.classes" :key="c.code" :class="{ 'text-muted': !c.isActive }">
				<td class="fw-semibold">{{ c.code }}</td><td>{{ c.nameFr }}</td><td>{{ c.nameEn }}</td><td>{{ t('config.' + c.tracking) }}</td><td>{{ c.cfihosCode || t('common.none') }}</td><td>{{ c.isActive ? t('common.yes') : t('common.no') }}</td>
				<td class="text-end"><button class="btn btn-sm btn-light" @click="openClass(c)"><i class="fa-solid fa-pen"></i></button></td>
			</tr></tbody>
		</table>
	</div>

	<div class="card-is mb-4">
		<div class="p-3 d-flex border-bottom align-items-center"><strong class="me-auto">{{ t('config.attributes') }}</strong><button class="btn btn-primary btn-sm" @click="am = { classCode: '', attrKey: '', labelFr: '', labelEn: '', dataType: 'text', cfihosRef: '' }"><i class="fa-solid fa-plus me-1"></i>{{ t('config.newAttr') }}</button></div>
		<table class="table table-sm table-is mb-0">
			<thead><tr><th>{{ t('config.key') }}</th><th>{{ t('config.nameFr') }}</th><th>{{ t('config.nameEn') }}</th><th>{{ t('config.type') }}</th><th>Classe</th><th>CFIHOS</th><th></th></tr></thead>
			<tbody>
				<tr v-if="!attrs.length"><td colspan="7" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
				<tr v-for="a in attrs" :key="a.id"><td>{{ a.attrKey }}</td><td>{{ a.labelFr }}</td><td>{{ a.labelEn }}</td><td>{{ a.dataType }}</td><td>{{ a.classCode || t('common.all') }}</td><td>{{ a.cfihosRef || t('common.none') }}</td><td class="text-end"><button class="btn btn-sm btn-light text-danger" @click="delAttr(a)"><i class="fa-solid fa-trash"></i></button></td></tr>
			</tbody>
		</table>
	</div>
	<p class="text-muted small">{{ t('config.more') }}</p>

	<Modal v-if="cm" :title="cm.isNew ? t('config.newClass') : cm.code" @close="cm = null">
		<form id="clsform" class="row g-3" @submit.prevent="saveClass">
			<div class="col-md-4"><label class="form-label">Code</label><input v-model="cm.code" class="form-control" maxlength="20" :disabled="!cm.isNew" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.nameFr') }}</label><input v-model="cm.nameFr" class="form-control" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.nameEn') }}</label><input v-model="cm.nameEn" class="form-control" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.tracking') }}</label><select v-model="cm.tracking" class="form-select"><option value="thickness">{{ t('config.thickness') }}</option><option value="condition">{{ t('config.condition') }}</option></select></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.cfihos') }}</label><input v-model="cm.cfihosCode" class="form-control" /></div>
			<div class="col-md-4 pt-md-4"><div class="form-check"><input id="ca" v-model="cm.isActive" type="checkbox" class="form-check-input" /><label for="ca" class="form-check-label">{{ t('config.active') }}</label></div></div>
		</form>
		<template #footer><button class="btn btn-light" @click="cm = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="clsform" type="submit">{{ t('common.save') }}</button></template>
	</Modal>

	<Modal v-if="am" :title="t('config.newAttr')" @close="am = null">
		<form id="attrform" class="row g-3" @submit.prevent="saveAttr">
			<div class="col-md-6"><label class="form-label">{{ t('config.key') }}</label><input v-model="am.attrKey" class="form-control" pattern="[a-z][a-z0-9_]*" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('config.type') }}</label><select v-model="am.dataType" class="form-select"><option>text</option><option>number</option><option>date</option><option>boolean</option></select></div>
			<div class="col-md-6"><label class="form-label">{{ t('config.nameFr') }}</label><input v-model="am.labelFr" class="form-control" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('config.nameEn') }}</label><input v-model="am.labelEn" class="form-control" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('config.scope') }}</label><select v-model="am.classCode" class="form-select"><option value="">{{ t('common.all') }}</option><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select></div>
			<div class="col-md-6"><label class="form-label">{{ t('config.cfihos') }}</label><input v-model="am.cfihosRef" class="form-control" /></div>
		</form>
		<template #footer><button class="btn btn-light" @click="am = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="attrform" type="submit">{{ t('common.save') }}</button></template>
	</Modal>
</template>
