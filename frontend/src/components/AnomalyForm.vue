<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import Modal from './Modal.vue';
import AssetPicker from './AssetPicker.vue';

// Création d'une anomalie ; draft = préremplissage depuis une suggestion d'inspection { asset, priority, inspectionId, reference }.
const props = defineProps({ draft: Object, asset: Object });
const emit = defineEmits(['close', 'saved']);
const { t } = useI18n();
const toast = useToast();

const asset = ref(props.draft?.asset ?? props.asset ?? null);
const f = ref({
	title: props.draft?.reference ? t('an.fromInspection', { ref: props.draft.reference }) : '',
	description: '', priority: props.draft?.priority ?? 'P3', owner: '',
	actions: [{ text: '', owner: '' }], repairOn: false, repair: { type: '', installedOn: '', expiresOn: '' },
});
const errors = ref([]);
const busy = ref(false);

async function save() {
	busy.value = true; errors.value = [];
	const body = {
		assetId: asset.value.id, title: f.value.title, description: f.value.description, priority: f.value.priority, owner: f.value.owner,
		sourceInspectionId: props.draft?.inspectionId ?? null,
		actions: f.value.actions.filter((a) => a.text.trim()).map((a) => ({ text: a.text, owner: a.owner })),
		repair: f.value.repairOn ? { type: f.value.repair.type, installedOn: f.value.repair.installedOn || null, expiresOn: f.value.repair.expiresOn } : null,
	};
	try { const r = await api('/anomalies', { method: 'POST', body }); toast.success(t('an.created')); emit('saved', r); }
	catch (e) { errors.value = e.details?.map((d) => `${d.field} : ${d.message}`) ?? [e.message]; } finally { busy.value = false; }
}
</script>

<template>
	<Modal :title="t('an.new')" wide @close="emit('close')">
		<div v-if="errors.length" class="alert alert-danger py-2"><div v-for="e in errors" :key="e">{{ e }}</div></div>
		<form id="anform" class="row g-3" @submit.prevent="save">
			<div class="col-md-6"><label class="form-label">{{ t('an.asset') }} *</label><AssetPicker v-model="asset" :disabled="!!(props.draft?.asset || props.asset)" /></div>
			<div class="col-md-6">
				<label class="form-label">{{ t('an.priority') }} *</label>
				<select v-model="f.priority" class="form-select"><option v-for="p in ['P1', 'P2', 'P3', 'P4']" :key="p" :value="p">{{ t('an.' + p) }}</option></select>
			</div>
			<div class="col-12"><label class="form-label">{{ t('an.titleField') }} *</label><input v-model="f.title" class="form-control" maxlength="255" required /></div>
			<div class="col-12"><label class="form-label">{{ t('an.description') }}</label><textarea v-model="f.description" class="form-control" rows="2"></textarea></div>
			<div class="col-md-6"><label class="form-label">{{ t('an.owner') }}</label><input v-model="f.owner" class="form-control" maxlength="120" /></div>
			<div class="col-12">
				<div class="form-label">{{ t('an.actions') }}</div>
				<div v-for="(a, i) in f.actions" :key="i" class="d-flex gap-2 mb-2">
					<input v-model="a.text" class="form-control" :placeholder="t('an.action')" />
					<input v-model="a.owner" class="form-control" style="max-width: 200px" :placeholder="t('an.owner')" />
					<button type="button" class="btn btn-light text-danger" @click="f.actions.splice(i, 1)"><i class="fa-solid fa-xmark"></i></button>
				</div>
				<button type="button" class="btn btn-sm btn-outline-secondary" @click="f.actions.push({ text: '', owner: '' })">{{ t('an.addAction') }}</button>
			</div>
			<div class="col-12">
				<div class="form-check mb-2"><input id="rep" v-model="f.repairOn" type="checkbox" class="form-check-input" /><label for="rep" class="form-check-label">{{ t('an.repair') }}</label></div>
				<div v-if="f.repairOn" class="row g-2">
					<div class="col-md-5"><input v-model="f.repair.type" class="form-control" :placeholder="t('an.repairType')" required /></div>
					<div class="col-md-3"><input v-model="f.repair.installedOn" type="date" class="form-control" :title="t('an.installedOn')" /></div>
					<div class="col-md-4"><input v-model="f.repair.expiresOn" type="date" class="form-control" :title="t('an.expiresOn')" required /></div>
				</div>
			</div>
		</form>
		<template #footer>
			<button class="btn btn-light" @click="emit('close')">{{ t('common.cancel') }}</button>
			<button class="btn btn-primary" form="anform" type="submit" :disabled="busy || !asset">{{ t('common.create') }}</button>
		</template>
	</Modal>
</template>
