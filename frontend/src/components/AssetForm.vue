<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import Modal from './Modal.vue';

const props = defineProps({ asset: Object });
const emit = defineEmits(['close', 'saved']);
const { t, locale } = useI18n();
const toast = useToast();
const a = props.asset;
const editing = !!a;

const f = ref({
	tag: a?.tag ?? '', systemId: a?.systemId ?? '', classCode: a?.classCode ?? '', description: a?.description ?? '',
	fluid: a?.fluid ?? '', material: a?.material ?? '', designPressureBarg: a?.designPressureBarg ?? '', designTempC: a?.designTempC ?? '',
	odMm: a?.odMm ?? '', nominalThicknessMm: a?.nominalThicknessMm ?? '', installYear: a?.installYear ?? '',
	discipline: a?.discipline ?? '', mechanisms: (a?.degradationMechanisms ?? []).join(', '), critS: a?.crit.s ?? '', critE: a?.crit.e ?? '', critP: a?.crit.p ?? '',
});
const errors = ref([]);
const busy = ref(false);

// Seuls les systèmes des installations où l'utilisateur est ingénieur sont proposés.
const systems = computed(() => lookups.systems.filter((s) => auth.can(s.facilityId, 'engineer')));
const classes = computed(() => lookups.classes.filter((c) => c.isActive || c.code === a?.classCode));
const scores = [1, 2, 3, 4, 5];

async function save() {
	busy.value = true; errors.value = [];
	const body = {
		tag: f.value.tag, systemId: Number(f.value.systemId), classCode: f.value.classCode, discipline: f.value.discipline, description: f.value.description,
		fluid: f.value.fluid, material: f.value.material, designPressureBarg: f.value.designPressureBarg, designTempC: f.value.designTempC,
		odMm: f.value.odMm, nominalThicknessMm: f.value.nominalThicknessMm, installYear: f.value.installYear,
		degradationMechanisms: f.value.mechanisms.split(',').map((s) => s.trim()).filter(Boolean),
		critS: f.value.critS, critE: f.value.critE, critP: f.value.critP,
	};
	try {
		const r = await api(editing ? `/assets/${a.id}` : '/assets', { method: editing ? 'PUT' : 'POST', body });
		toast.success(t(editing ? 'assets.updated' : 'assets.created'));
		emit('saved', r);
	} catch (e) {
		errors.value = e.details?.map((d) => `${d.field} : ${d.message}`) ?? [e.status === 409 ? t('assets.tagTaken') : e.message];
	} finally { busy.value = false; }
}
</script>

<template>
	<Modal :title="editing ? `${t('common.edit')} — ${a.tag}` : t('assets.new')" wide @close="emit('close')">
		<div v-if="errors.length" class="alert alert-danger py-2"><div v-for="e in errors" :key="e">{{ e }}</div></div>
		<form id="assetform" class="row g-3" @submit.prevent="save">
			<div class="col-md-4"><label class="form-label">{{ t('assets.tag') }} *</label><input v-model="f.tag" class="form-control" maxlength="60" required /></div>
			<div class="col-md-4">
				<label class="form-label">{{ t('assets.system') }} *</label>
				<select v-model="f.systemId" class="form-select" required>
					<option value="" disabled></option>
					<option v-for="s in systems" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
				</select>
			</div>
			<div class="col-md-4">
				<label class="form-label">{{ t('assets.class') }} *</label>
				<select v-model="f.classCode" class="form-select" required>
					<option value="" disabled></option>
					<option v-for="c in classes" :key="c.code" :value="c.code">{{ c.code }} — {{ lookups.className(c.code, locale) }}</option>
				</select>
			</div>
			<div class="col-md-4">
				<label class="form-label">{{ t('assets.discipline') }}</label>
				<select v-model="f.discipline" class="form-select">
					<option value="">{{ t('cfg.defaultDiscipline') }} ({{ lookups.classes.find((c) => c.code === f.classCode)?.defaultDiscipline ?? '—' }})</option>
					<option v-for="d in lookups.disciplines" :key="d" :value="d">{{ d }}</option>
				</select>
			</div>
			<div class="col-md-8"><label class="form-label">{{ t('assets.description') }} *</label><input v-model="f.description" class="form-control" maxlength="255" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('assets.fluid') }}</label><input v-model="f.fluid" class="form-control" maxlength="80" /></div>
			<div class="col-md-4"><label class="form-label">{{ t('assets.material') }}</label><input v-model="f.material" class="form-control" maxlength="80" /></div>
			<div class="col-md-4"><label class="form-label">{{ t('assets.installYear') }}</label><input v-model="f.installYear" type="number" min="1900" max="2100" class="form-control" /></div>
			<div class="col-md-3"><label class="form-label">{{ t('assets.designPressure') }}</label><input v-model="f.designPressureBarg" type="number" step="any" min="0" class="form-control" /></div>
			<div class="col-md-3"><label class="form-label">{{ t('assets.designTemp') }}</label><input v-model="f.designTempC" type="number" step="any" class="form-control" /></div>
			<div class="col-md-3"><label class="form-label">{{ t('assets.od') }}</label><input v-model="f.odMm" type="number" step="any" min="0" class="form-control" /></div>
			<div class="col-md-3"><label class="form-label">{{ t('assets.nominalThickness') }}</label><input v-model="f.nominalThicknessMm" type="number" step="any" min="0" class="form-control" /></div>
			<div class="col-12"><label class="form-label">{{ t('assets.mechanisms') }}</label><input v-model="f.mechanisms" class="form-control" :placeholder="t('assets.mechanismsHint')" /></div>
			<div class="col-12"><div class="form-label mb-1">{{ t('assets.crit') }}</div></div>
			<div v-for="k in ['critS', 'critE', 'critP']" :key="k" class="col-md-4">
				<label class="form-label small text-muted">{{ t('assets.' + k) }}</label>
				<select v-model="f[k]" class="form-select"><option value="">{{ t('assets.critDefault') }}</option><option v-for="s in scores" :key="s" :value="s">{{ s }}</option></select>
			</div>
		</form>
		<template #footer>
			<button class="btn btn-light" @click="emit('close')">{{ t('common.cancel') }}</button>
			<button class="btn btn-primary" form="assetform" type="submit" :disabled="busy">{{ t('common.save') }}</button>
		</template>
	</Modal>
</template>
