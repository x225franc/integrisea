<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { num } from '@/utils';
import Modal from './Modal.vue';
import AssetPicker from './AssetPicker.vue';
import ExplainLines from './ExplainLines.vue';

// Saisie d'une inspection (utilisable sur tablette) : gabarit selon la classe, relevés par CML, grade calculé automatiquement.
const props = defineProps({ asset: Object, edit: Object });
const emit = defineEmits(['close', 'saved', 'suggest']);
const { t } = useI18n();
const toast = useToast();

const asset = ref(props.asset ?? null);
const templates = ref([]);
const templateId = ref(props.edit?.templateId ?? '');
const date = ref(props.edit?.performedOn ?? new Date().toISOString().slice(0, 10));
const inspector = ref(props.edit?.inspector ?? '');
const data = ref({ ...(props.edit?.data ?? {}) });
const readings = ref((props.edit?.readings ?? []).map((r) => ({ ...r })));
const errors = ref([]);
const busy = ref(false);
const result = ref(null);

onMounted(async () => {
	templates.value = (await api('/inspections/templates')).filter((x) => x.isActive);
	if (!readings.value.length) readings.value.push({ cml: 'CML-01', t: '' });
});

const choices = computed(() => (asset.value ? templates.value.filter((x) => x.classes.includes(asset.value.classCode)) : []));
const tpl = computed(() => templates.value.find((x) => x.id === templateId.value));
const addReading = () => readings.value.push({ cml: `CML-${String(readings.value.length + 1).padStart(2, '0')}`, t: '' });

async function save() {
	busy.value = true; errors.value = [];
	const body = {
		performedOn: date.value, inspector: inspector.value, data: data.value,
		readings: tpl.value?.fields.some((f) => f.t === 'cml') ? readings.value.filter((r) => r.t !== '').map((r) => ({ cml: r.cml, t: Number(r.t) })) : undefined,
	};
	try {
		if (props.edit) result.value = await api(`/inspections/${props.edit.id}`, { method: 'PUT', body });
		else result.value = await api('/inspections', { method: 'POST', body: { ...body, assetId: asset.value.id, templateId: templateId.value } });
		toast.success(t('insp.saved'));
		emit('saved', result.value);
	} catch (e) { errors.value = e.details?.map((d) => `${d.field} : ${d.message}`) ?? [e.message]; } finally { busy.value = false; }
}
const suggest = () => emit('suggest', { asset: asset.value, priority: result.value.suggestion.priority, inspectionId: result.value.id, reference: result.value.reference });
</script>

<template>
	<Modal :title="props.edit ? `${t('insp.edit')} — ${props.edit.reference}` : t('insp.new')" wide @close="emit('close')">
		<!-- Étape 2 : résultat -->
		<div v-if="result">
			<h2 class="h6">{{ t('insp.resultTitle') }}</h2>
			<div class="row g-3 mb-3">
				<div class="col-6 col-md-3"><div class="small text-muted">{{ t('insp.reference') }}</div><strong>{{ result.reference ?? props.edit?.reference }}</strong></div>
				<div class="col-6 col-md-3"><div class="small text-muted">{{ t('insp.computedGrade') }}</div><strong>{{ result.grade ?? t('common.none') }}</strong></div>
				<div class="col-6 col-md-3"><div class="small text-muted">{{ t('insp.newRisk') }}</div><span class="risk-badge" :class="`risk-${result.evaluation.risk}`">{{ result.evaluation.risk }}</span> PoF {{ result.evaluation.pof }}</div>
				<div class="col-6 col-md-3"><div class="small text-muted">{{ t('insp.nextDue') }}</div><strong>{{ result.evaluation.dueDate ?? t('common.none') }}</strong></div>
			</div>
			<ExplainLines v-if="result.gradeReasons?.length" :lines="result.gradeReasons" class="mb-3" />
			<div v-if="result.suggestion" class="alert alert-warning">
				<strong><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ t('insp.suggestTitle') }}</strong>
				<div>{{ t('insp.suggestText', { p: result.suggestion.priority }) }}</div>
				<ExplainLines :lines="result.suggestion.triggers.map((x) => ({ code: x.code, params: x.params }))" />
				<button class="btn btn-sm btn-warning mt-2" @click="suggest">{{ t('insp.createAnomaly') }}</button>
			</div>
		</div>

		<!-- Étape 1 : formulaire -->
		<div v-else>
			<div v-if="errors.length" class="alert alert-danger py-2"><div v-for="e in errors" :key="e">{{ e }}</div></div>
			<div class="row g-3">
				<div class="col-md-6"><label class="form-label">{{ t('insp.asset') }} *</label><AssetPicker v-model="asset" :disabled="!!props.asset || !!props.edit" @update:model-value="templateId = ''" /></div>
				<div class="col-md-6">
					<label class="form-label">{{ t('insp.template') }} *</label>
					<select v-model="templateId" class="form-select" :disabled="!asset || !!props.edit">
						<option value="" disabled>{{ asset && !choices.length ? t('insp.noTemplate') : t('insp.choose') }}</option>
						<option v-for="x in choices" :key="x.id" :value="x.id">{{ x.name }}</option>
					</select>
				</div>
				<div class="col-md-6"><label class="form-label">{{ t('insp.date') }} *</label><input v-model="date" type="date" class="form-control" :max="new Date().toISOString().slice(0, 10)" required /></div>
				<div class="col-md-6"><label class="form-label">{{ t('insp.inspector') }}</label><input v-model="inspector" class="form-control" maxlength="120" /></div>

				<template v-if="tpl">
					<div v-for="f in tpl.fields" :key="f.k" :class="f.t === 'textarea' || f.t === 'cml' ? 'col-12' : 'col-md-6'">
						<template v-if="f.t === 'cml'">
							<label class="form-label">{{ t('insp.readings') }}</label>
							<div v-for="(r, i) in readings" :key="i" class="d-flex gap-2 mb-2">
								<input v-model="r.cml" class="form-control" style="max-width: 130px" :placeholder="t('insp.cml')" />
								<input v-model="r.t" type="number" step="0.01" min="0" inputmode="decimal" class="form-control" :placeholder="t('insp.thickness')" />
								<button type="button" class="btn btn-light text-danger" :disabled="readings.length === 1" @click="readings.splice(i, 1)"><i class="fa-solid fa-xmark"></i></button>
							</div>
							<button type="button" class="btn btn-sm btn-outline-secondary" @click="addReading"><i class="fa-solid fa-plus me-1"></i>{{ t('insp.addReading') }}</button>
						</template>
						<template v-else>
							<label class="form-label">{{ f.l }}</label>
							<select v-if="f.t === 'grade'" v-model="data[f.k]" class="form-select"><option :value="undefined">{{ t('insp.choose') }}</option><option v-for="g in 4" :key="g" :value="g">{{ g }}</option></select>
							<select v-else-if="f.t === 'select'" v-model="data[f.k]" class="form-select"><option :value="undefined">{{ t('insp.choose') }}</option><option v-for="o in f.o" :key="o" :value="o">{{ o }}</option></select>
							<div v-else-if="f.t === 'pf'" class="btn-group w-100">
								<input :id="`pf-${f.k}-p`" v-model="data[f.k]" type="radio" class="btn-check" value="Pass" /><label :for="`pf-${f.k}-p`" class="btn btn-outline-success">{{ t('insp.pass') }}</label>
								<input :id="`pf-${f.k}-f`" v-model="data[f.k]" type="radio" class="btn-check" value="Fail" /><label :for="`pf-${f.k}-f`" class="btn btn-outline-danger">{{ t('insp.fail') }}</label>
							</div>
							<textarea v-else-if="f.t === 'textarea'" v-model="data[f.k]" class="form-control" rows="2"></textarea>
							<input v-else-if="f.t === 'num'" v-model="data[f.k]" type="number" step="any" inputmode="decimal" class="form-control" />
							<input v-else v-model="data[f.k]" class="form-control" />
							<div v-if="f.t === 'grade'" class="form-text">{{ t('insp.gradeHelp') }}</div>
						</template>
					</div>
				</template>
			</div>
		</div>

		<template #footer>
			<button class="btn btn-light" @click="emit('close')">{{ result ? t('common.close') : t('common.cancel') }}</button>
			<button v-if="!result" class="btn btn-primary" :disabled="busy || !asset || !templateId" @click="save">{{ t('insp.save') }}</button>
		</template>
	</Modal>
</template>
