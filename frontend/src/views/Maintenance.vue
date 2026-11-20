<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api, download } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import { num } from '@/utils';
import Modal from '@/components/Modal.vue';
import ExportMenu from '@/components/ExportMenu.vue';

const { t } = useI18n();
const toast = useToast();
const rows = ref([]);
const eol = ref([]);
const cls = ref('');
const m = ref(null);
const docFacility = ref('');
const docClass = ref('');

const canEdit = computed(() => auth.user.isAdmin || auth.canAny('engineer'));
async function load() {
	await lookups.load();
	if (!docFacility.value) docFacility.value = auth.facility || lookups.facilities[0]?.id || ''; // après le chargement des installations
	rows.value = await api('/maintenance/fmea', { query: { class: cls.value } });
	eol.value = await api('/maintenance/end-of-life', { query: { facility: auth.facility } });
}
watch([cls, () => auth.facility], load);
onMounted(load);

const open = (r) => (m.value = r ? { ...r, intervalMonths: r.intervalMonths ?? '' } : { classCode: cls.value || 'PIPE', failureMode: '', mechanism: '', effect: '', task: '', method: '', intervalMonths: '', discipline: '' });
async function save() {
	const b = { ...m.value, intervalMonths: m.value.intervalMonths === '' ? null : Number(m.value.intervalMonths) };
	try { await api(b.id ? `/maintenance/fmea/${b.id}` : '/maintenance/fmea', { method: b.id ? 'PUT' : 'POST', body: b }); m.value = null; toast.success(t('common.saved')); load(); }
	catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function del(r) { if (!confirm(t('common.delete') + ' ?')) return; await api(`/maintenance/fmea/${r.id}`, { method: 'DELETE' }); toast.success(t('maint.deleted')); load(); }
const gen = (format) => download('/maintenance/strategy-document', { facility: docFacility.value, class: docClass.value, format }, `strategie.${format}`).catch((e) => toast.error(e.message));
</script>

<template>
	<h1 class="h4 mb-3">{{ t('maint.title') }}</h1>

	<div class="card-is p-3 mb-3">
		<h2 class="h6">{{ t('maint.document') }}</h2>
		<p class="text-muted small mb-2">{{ t('maint.docHint') }}</p>
		<div class="d-flex flex-wrap gap-2 align-items-center">
			<select v-model="docFacility" class="form-select form-select-sm" style="max-width: 240px"><option v-for="f in lookups.facilities" :key="f.id" :value="f.id">{{ f.name }}</option></select>
			<select v-model="docClass" class="form-select form-select-sm" style="max-width: 200px"><option value="">{{ t('maint.allClasses') }}</option><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select>
			<button class="btn btn-sm btn-outline-primary" :disabled="!docFacility" @click="gen('pdf')"><i class="fa-solid fa-file-pdf me-1"></i>{{ t('maint.pdf') }}</button>
			<button class="btn btn-sm btn-outline-primary" :disabled="!docFacility" @click="gen('docx')"><i class="fa-solid fa-file-word me-1"></i>{{ t('maint.word') }}</button>
		</div>
	</div>

	<div class="card-is mb-4">
		<div class="p-3 d-flex flex-wrap gap-2 align-items-center border-bottom">
			<strong class="me-auto">{{ t('maint.library') }}</strong>
			<select v-model="cls" class="form-select form-select-sm" style="max-width: 170px"><option value="">{{ t('maint.allClasses') }}</option><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select>
			<ExportMenu path="/maintenance/fmea" :query="{ class: cls }" name="fmea" />
			<button v-if="canEdit" class="btn btn-primary btn-sm" @click="open()"><i class="fa-solid fa-plus me-1"></i>{{ t('maint.newLine') }}</button>
		</div>
		<div class="table-responsive">
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('maint.class') }}</th><th>{{ t('maint.failureMode') }}</th><th>{{ t('maint.mechanism') }}</th><th>{{ t('maint.effect') }}</th><th>{{ t('maint.task') }}</th><th>{{ t('maint.method') }}</th><th>{{ t('maint.interval') }}</th><th>{{ t('maint.discipline') }}</th><th></th></tr></thead>
				<tbody>
					<tr v-for="r in rows" :key="r.id">
						<td><span class="badge badge-class">{{ r.classCode }}</span></td><td>{{ r.failureMode }}</td><td>{{ r.mechanism }}</td><td>{{ r.effect }}</td><td>{{ r.task }}</td><td>{{ r.method }}</td>
						<td class="text-nowrap"><span v-if="r.intervalMonths == null" class="badge text-bg-info">{{ t('maint.rbi') }}</span><span v-else>{{ r.intervalMonths }} {{ t('maint.months') }}</span></td>
						<td>{{ r.discipline }}</td>
						<td class="text-end text-nowrap"><template v-if="canEdit"><button class="btn btn-sm btn-light" @click="open(r)"><i class="fa-solid fa-pen"></i></button><button class="btn btn-sm btn-light text-danger" @click="del(r)"><i class="fa-solid fa-trash"></i></button></template></td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<div class="card-is">
		<div class="p-3 pb-0 d-flex align-items-center"><h2 class="h6 me-auto">{{ t('maint.endOfLife') }}</h2><ExportMenu path="/maintenance/end-of-life" :query="{ facility: auth.facility }" name="fin-de-vie" /></div>
		<p class="text-muted small px-3">{{ t('maint.endOfLifeHint') }}</p>
		<table class="table table-sm table-is mb-0">
			<thead><tr><th>{{ t('assets.tag') }}</th><th>{{ t('assets.class') }}</th><th>{{ t('rbi.rl') }}</th><th>{{ t('risk.risk') }}</th><th>{{ t('maint.urgent') }}</th><th>{{ t('rbi.due') }}</th></tr></thead>
			<tbody>
				<tr v-if="!eol.length"><td colspan="6" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
				<tr v-for="a in eol" :key="a.assetId"><td><router-link :to="`/assets/${a.assetId}`" class="tag-link">{{ a.tag }}</router-link> <small class="text-muted">{{ a.description }}</small></td><td>{{ a.classCode }}</td><td>{{ a.remainingLife != null ? num(a.remainingLife, 1) : t('common.none') }}</td><td><span class="risk-badge" :class="`risk-${a.risk}`">{{ a.risk }}</span></td><td>{{ a.urgentAnomalies || '' }}</td><td>{{ a.dueDate }}</td></tr>
			</tbody>
		</table>
	</div>

	<Modal v-if="m" :title="m.id ? t('common.edit') : t('maint.newLine')" wide @close="m = null">
		<form id="fmea" class="row g-3" @submit.prevent="save">
			<div class="col-md-3"><label class="form-label">{{ t('maint.class') }}</label><select v-model="m.classCode" class="form-select"><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select></div>
			<div class="col-md-9"><label class="form-label">{{ t('maint.failureMode') }} *</label><input v-model="m.failureMode" class="form-control" required /></div>
			<div class="col-md-6"><label class="form-label">{{ t('maint.mechanism') }}</label><input v-model="m.mechanism" class="form-control" /></div>
			<div class="col-md-6"><label class="form-label">{{ t('maint.effect') }}</label><input v-model="m.effect" class="form-control" /></div>
			<div class="col-md-8"><label class="form-label">{{ t('maint.task') }} *</label><input v-model="m.task" class="form-control" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('maint.method') }}</label><input v-model="m.method" class="form-control" /></div>
			<div class="col-md-4"><label class="form-label">{{ t('maint.interval') }} ({{ t('maint.months') }})</label><input v-model="m.intervalMonths" type="number" min="1" class="form-control" /><div class="form-text">{{ t('maint.fixedHint') }}</div></div>
			<div class="col-md-4"><label class="form-label">{{ t('maint.discipline') }}</label><input v-model="m.discipline" class="form-control" /></div>
		</form>
		<template #footer><button class="btn btn-light" @click="m = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="fmea" type="submit">{{ t('common.save') }}</button></template>
	</Modal>
</template>
