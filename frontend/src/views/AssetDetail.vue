<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api, download } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import { settings } from '@/stores/settings';
import { num, STATUS_CLASS, PRIORITY_CLASS, AN_STATUS_CLASS } from '@/utils';
import AssetForm from '@/components/AssetForm.vue';
import RiskMatrix from '@/components/RiskMatrix.vue';
import ExplainLines from '@/components/ExplainLines.vue';
import ThicknessChart from '@/components/ThicknessChart.vue';
import InspectionForm from '@/components/InspectionForm.vue';
import AnomalyForm from '@/components/AnomalyForm.vue';
import AnomalyDialog from '@/components/AnomalyDialog.vue';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const a = ref(null);
const tab = ref('attributes');
const showForm = ref(false);
const loaded = ref({});
const rbi = ref(null);
const inspections = ref([]);
const anomalies = ref([]);
const strategy = ref(null);
const bom = ref([]);
const allParts = ref([]);
const docs = ref([]);
const history = ref([]);
const inspForm = ref(false);
const anomalyForm = ref(null);
const anomalyOpen = ref(null);
const partToAdd = ref('');

const matrixProvisional = computed(() => settings.data?._meta?.provisional?.includes('matrix'));
const canEdit = computed(() => a.value && auth.can(a.value.facilityId, 'engineer'));
const canInspect = computed(() => a.value && auth.can(a.value.facilityId, 'inspector'));
const tabs = ['attributes', 'criticality', 'inspections', 'anomalies', 'maintenance', 'spares', 'documents', 'history'];
const v = (x) => (x === null || x === undefined || x === '' ? t('common.none') : x);
const assetObj = computed(() => a.value && { id: a.value.id, tag: a.value.tag, description: a.value.description, classCode: a.value.classCode, facilityId: a.value.facilityId });

async function loadAsset() {
	try { a.value = await api(`/assets/${route.params.id}`); } catch { router.replace('/assets'); return; }
	await lookups.load();
	loaded.value = {};
	await ensure(tab.value);
}
const loaders = {
	async criticality() { rbi.value = await api(`/rbi/assets/${a.value.id}`); },
	async inspections() { inspections.value = (await api('/inspections', { query: { asset: a.value.id, limit: 100 } })).items; },
	async anomalies() { anomalies.value = (await api('/anomalies', { query: { asset: a.value.id, status: 'all', limit: 100 } })).items; },
	async maintenance() { strategy.value = await api(`/maintenance/strategy/asset/${a.value.id}`); },
	async spares() { bom.value = await api('/materials/bom', { query: { asset: a.value.id } }); if (canEdit.value) allParts.value = await api('/materials/parts'); },
	async documents() { docs.value = (await api('/documents', { query: { asset: a.value.id, limit: 100 } })).items; },
	async history() { if (canEdit.value) history.value = (await api('/audit', { query: { entity: 'asset', entityId: a.value.id, limit: 100 } })).items; },
};
async function ensure(k) { if (loaders[k] && !loaded.value[k]) { loaded.value[k] = true; await loaders[k](); } }
watch(tab, ensure);
onMounted(loadAsset);

const reload = async (...keys) => { for (const k of keys) { loaded.value[k] = false; if (k === tab.value) await ensure(k); } };
async function toggleArchive() {
	if (!a.value.archivedAt && !confirm(t('assets.archiveConfirm'))) return;
	await api(`/assets/${a.value.id}/${a.value.archivedAt ? 'restore' : 'archive'}`, { method: 'POST' });
	toast.success(t('common.saved')); loadAsset();
}
async function addPart() { await api('/materials/bom', { method: 'POST', body: { assetId: a.value.id, partId: Number(partToAdd.value), quantity: 1 } }); partToAdd.value = ''; reload('spares'); }
async function removePart(p) { await api(`/materials/bom/${a.value.id}/${p.id}`, { method: 'DELETE' }); reload('spares'); }
const onInspSaved = () => { reload('inspections', 'criticality', 'anomalies'); };
const onSuggest = (s) => { inspForm.value = false; anomalyForm.value = s; };
const fmt = (o) => (o ? JSON.stringify(o, null, 1) : '');
const ev = computed(() => rbi.value?.evaluation);
const selectedCell = computed(() => (ev.value ? { pof: ev.value.pof, cof: ev.value.cof } : null));
</script>

<template>
	<div v-if="a">
		<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
			<router-link to="/assets" class="btn btn-sm btn-light"><i class="fa-solid fa-arrow-left"></i></router-link>
			<h1 class="h4 mb-0">{{ a.tag }}</h1>
			<span class="badge badge-class">{{ a.classCode }}</span>
			<span v-if="a.archivedAt" class="badge badge-arch">{{ t('assets.archived') }}</span>
			<span class="text-muted">{{ a.description }}</span>
			<div class="ms-auto d-flex gap-2">
				<button v-if="canInspect && !a.archivedAt" class="btn btn-sm btn-primary" @click="inspForm = true"><i class="fa-solid fa-clipboard-check me-1"></i>{{ t('insp.new') }}</button>
				<button v-if="canEdit" class="btn btn-sm btn-outline-secondary" @click="showForm = true"><i class="fa-solid fa-pen me-1"></i>{{ t('common.edit') }}</button>
				<button v-if="canEdit" class="btn btn-sm btn-outline-secondary" @click="toggleArchive"><i class="fa-solid fa-box-archive me-1"></i>{{ a.archivedAt ? t('assets.restore') : t('assets.archive') }}</button>
			</div>
		</div>

		<ul class="nav nav-tabs mb-3 flex-nowrap overflow-auto">
			<li v-for="k in tabs" :key="k" v-show="k !== 'history' || canEdit" class="nav-item"><a class="nav-link text-nowrap" :class="{ active: tab === k }" href="#" @click.prevent="tab = k">{{ t('assets.tabs.' + k) }}</a></li>
		</ul>

		<!-- Attributs -->
		<div v-if="tab === 'attributes'" class="card-is p-4">
			<dl class="attr-grid mb-0">
				<div><dt>{{ t('assets.facility') }}</dt><dd>{{ a.facilityName }}</dd></div>
				<div><dt>{{ t('assets.system') }}</dt><dd>{{ a.systemCode }} — {{ a.systemName }}</dd></div>
				<div><dt>{{ t('assets.class') }}</dt><dd>{{ lookups.className(a.classCode, locale) }}</dd></div>
				<div><dt>{{ t('assets.discipline') }}</dt><dd>{{ v(a.discipline) }}</dd></div>
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

		<!-- Criticité / RBI -->
		<div v-else-if="tab === 'criticality'">
			<div v-if="ev" class="row g-3">
				<div class="col-lg-5">
					<div class="card-is p-3 mb-3">
						<div class="d-flex flex-wrap gap-3 align-items-center mb-2">
							<div><div class="small text-muted">{{ t('risk.risk') }}</div><span class="risk-badge fs-6" :class="`risk-${ev.risk}`">{{ ev.risk }}</span></div>
							<div><div class="small text-muted">PoF / CoF</div><strong>{{ ev.pof }} / {{ ev.cof }}</strong></div>
							<div><div class="small text-muted">{{ t('risk.crit') }}</div><strong>{{ ev.criticality }}</strong><i v-if="ev.sce" class="fa-solid fa-shield ms-1 text-danger" :title="t('risk.sce')"></i></div>
							<div><div class="small text-muted">{{ t('rbi.due') }}</div><strong>{{ ev.dueDate ?? t('common.none') }}</strong> <span class="badge" :class="STATUS_CLASS[ev.status]">{{ t('sched.' + ev.status) }}</span></div>
						</div>
						<div v-if="!ev.calculable" class="alert alert-warning py-2 small mb-2">{{ t('risk.notCalculable') }} : {{ ev.incomplete.join(', ') }}</div>
						<dl class="attr-grid small mb-0">
							<div v-if="ev.tracking === 'thickness'"><dt>{{ t('rbi.tmin') }}</dt><dd>{{ num(ev.tmin) }}</dd></div>
							<div v-if="ev.tracking === 'thickness' && ev.governingCml"><dt>{{ t('rbi.governing') }}</dt><dd>{{ t('rbi.governingInfo', { cml: ev.governingCml, t: num(ev.tLast), cr: num(ev.cr, 3) }) }}</dd></div>
							<div v-if="ev.tracking === 'thickness'"><dt>{{ t('rbi.tLast') }}</dt><dd>{{ num(ev.tLast) }}</dd></div>
							<div v-if="ev.tracking === 'thickness'"><dt>{{ t('rbi.rate') }}</dt><dd>{{ num(ev.cr, 3) }}</dd></div>
							<div v-if="ev.tracking === 'thickness'"><dt>{{ t('rbi.rl') }}</dt><dd>{{ num(ev.rl, 1) }}</dd></div>
							<div><dt>{{ t('rbi.interval') }}</dt><dd>{{ ev.intervalMonths }}</dd></div>
							<div><dt>S / E / P</dt><dd>{{ rbi.crit.s ?? '—' }} / {{ rbi.crit.e ?? '—' }} / {{ rbi.crit.p ?? '—' }} <small class="text-muted">({{ rbi.critSource.s === 'asset' ? t('rbi.fromAsset') : t('rbi.fromDefault') }})</small></dd></div>
						</dl>
					</div>
					<div class="card-is p-3"><h2 class="h6">{{ t('rbi.matrixPos') }}</h2><div v-if="matrixProvisional" class="small text-warning-emphasis mb-2"><span class="badge text-bg-warning me-1">{{ t('prov.badge') }}</span>{{ t('prov.matrix') }}</div><RiskMatrix :matrix="rbi.matrix" :selected="selectedCell" :counts="{ [`${ev.pof}-${ev.cof}`]: 1 }" /></div>
				</div>
				<div class="col-lg-7">
					<div v-if="ev.tracking === 'thickness'" class="card-is p-3 mb-3"><h2 class="h6">{{ t('rbi.thickness') }}</h2><ThicknessChart :cmls="ev.cmls ?? []" :governing="ev.governingCml" :nominal="a.nominalThicknessMm" :tmin="ev.tmin" :install-year="a.installYear" />
						<div v-if="ev.cmls?.length" class="table-responsive mt-3">
							<table class="table table-sm table-is mb-0 small">
								<thead><tr><th>{{ t('rbi.cml') }}</th><th>{{ t('rbi.lastMeasure') }}</th><th>{{ t('rbi.tLast') }}</th><th>{{ t('rbi.refThickness') }}</th><th>{{ t('rbi.rate') }}</th><th>{{ t('rbi.rlCml') }}</th></tr></thead>
								<tbody>
									<tr v-for="c in ev.cmls" :key="c.id" :class="{ 'fw-semibold table-active': c.id === ev.governingCml }">
										<td>{{ c.id }}<span v-if="c.id === ev.governingCml" class="badge text-bg-primary ms-1">{{ t('rbi.governing') }}</span></td>
										<td>{{ c.lastDate }}</td><td>{{ num(c.tLast, 2) }}</td><td>{{ c.tRef != null ? num(c.tRef, 2) : t('common.none') }}</td>
										<td>{{ c.cr != null ? num(c.cr, 3) : t('common.none') }}</td><td>{{ c.rlRaw != null ? num(c.rl, 1) : t('common.none') }}</td>
									</tr>
								</tbody>
							</table>
						</div></div>
					<div class="card-is p-3">
						<h2 class="h6 mb-0">{{ t('rbi.calcDetail') }}</h2>
						<p class="text-muted small">{{ t('rbi.calcHint') }}</p>
						<ExplainLines :lines="ev.lines" />
						<div class="text-muted small mt-2">{{ t('rbi.engine', { v: rbi.engineVersion }) }}</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Inspections -->
		<div v-else-if="tab === 'inspections'" class="card-is">
			<div class="table-responsive"><table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('insp.reference') }}</th><th>{{ t('insp.template') }}</th><th>{{ t('common.date') }}</th><th>{{ t('insp.inspector') }}</th><th>{{ t('insp.grade') }}</th><th>{{ t('insp.minThickness') }}</th><th></th></tr></thead>
				<tbody>
					<tr v-if="!inspections.length"><td colspan="7" class="text-center text-muted py-3">{{ t('insp.none') }}</td></tr>
					<tr v-for="r in inspections" :key="r.id"><td class="fw-semibold">{{ r.reference }}</td><td>{{ r.templateName }}</td><td>{{ r.performedOn }}</td><td>{{ r.inspector }}</td><td>{{ v(r.grade) }}</td><td>{{ v(r.minThickness) }}</td><td class="text-end"><button class="btn btn-sm btn-light" @click="download(`/inspections/${r.id}/report`, {}, `${r.reference}.pdf`)"><i class="fa-solid fa-file-pdf"></i></button></td></tr>
				</tbody></table></div>
		</div>

		<!-- Anomalies -->
		<div v-else-if="tab === 'anomalies'" class="card-is">
			<div v-if="canInspect && !a.archivedAt" class="p-3 border-bottom"><button class="btn btn-sm btn-primary" @click="anomalyForm = {}"><i class="fa-solid fa-plus me-1"></i>{{ t('an.new') }}</button></div>
			<table class="table table-hover table-is mb-0">
				<thead><tr><th>{{ t('an.reference') }}</th><th>{{ t('an.titleField') }}</th><th>{{ t('an.priority') }}</th><th>{{ t('an.status') }}</th><th>{{ t('an.due') }}</th></tr></thead>
				<tbody>
					<tr v-if="!anomalies.length"><td colspan="5" class="text-center text-muted py-3">{{ t('an.none') }}</td></tr>
					<tr v-for="n in anomalies" :key="n.id" class="clickable" @click="anomalyOpen = n.id"><td class="fw-semibold">{{ n.reference }}</td><td>{{ n.title }}</td><td><span class="badge" :class="PRIORITY_CLASS[n.priority]">{{ n.priority }}</span></td><td><span class="badge" :class="AN_STATUS_CLASS[n.status]">{{ t('an.' + n.status) }}</span></td><td :class="{ 'text-danger': n.overdue }">{{ n.dueDate }}</td></tr>
				</tbody>
			</table>
		</div>

		<!-- Maintenance -->
		<div v-else-if="tab === 'maintenance'" class="card-is">
			<table v-if="strategy" class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('maint.failureMode') }}</th><th>{{ t('maint.mechanism') }}</th><th>{{ t('maint.task') }}</th><th>{{ t('maint.method') }}</th><th>{{ t('maint.interval') }}</th><th>{{ t('maint.discipline') }}</th></tr></thead>
				<tbody>
					<tr v-if="!strategy.tasks.length"><td colspan="6" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
					<tr v-for="x in strategy.tasks" :key="x.id"><td>{{ x.failureMode }}</td><td>{{ x.mechanism }}</td><td>{{ x.task }}</td><td>{{ x.method }}</td><td class="text-nowrap">{{ t('rbi.taskInterval', { m: x.effectiveIntervalMonths }) }} <span class="badge" :class="x.basis === 'rbi' ? 'text-bg-info' : 'text-bg-light border'">{{ x.basis === 'rbi' ? t('rbi.basisRbi') : t('rbi.basisFixed') }}</span></td><td>{{ x.discipline }}</td></tr>
				</tbody>
			</table>
		</div>

		<!-- Pièces de rechange -->
		<div v-else-if="tab === 'spares'" class="card-is">
			<div v-if="canEdit" class="p-3 border-bottom d-flex gap-2"><select v-model="partToAdd" class="form-select form-select-sm" style="max-width: 360px"><option value="">{{ t('mat.choosePart') }}</option><option v-for="p in allParts.filter((x) => !bom.some((b) => b.id === x.id))" :key="p.id" :value="p.id">{{ p.code }} — {{ p.description }}</option></select><button class="btn btn-sm btn-outline-primary" :disabled="!partToAdd" @click="addPart">{{ t('mat.linkPart') }}</button></div>
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('mat.code') }}</th><th>{{ t('mat.description') }}</th><th class="text-end">{{ t('mat.stock') }}</th><th class="text-end">{{ t('mat.min') }}</th><th></th></tr></thead>
				<tbody>
					<tr v-if="!bom.length"><td colspan="5" class="text-center text-muted py-3">{{ t('mat.noParts') }}</td></tr>
					<tr v-for="p in bom" :key="p.id" :class="{ 'table-warning': p.lowStock }"><td class="fw-semibold">{{ p.code }}</td><td>{{ p.description }}</td><td class="text-end" :class="{ 'text-danger fw-semibold': p.lowStock }">{{ p.stock }}</td><td class="text-end">{{ p.minStock }}</td><td class="text-end"><button v-if="canEdit" class="btn btn-sm btn-light text-danger" :title="t('mat.unlink')" @click="removePart(p)"><i class="fa-solid fa-xmark"></i></button></td></tr>
				</tbody>
			</table>
		</div>

		<!-- Documents -->
		<div v-else-if="tab === 'documents'" class="card-is">
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('docs.number') }}</th><th>{{ t('docs.docTitle') }}</th><th>{{ t('docs.type') }}</th><th>{{ t('docs.revision') }}</th><th></th></tr></thead>
				<tbody>
					<tr v-if="!docs.length"><td colspan="5" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
					<tr v-for="d in docs" :key="d.id"><td class="fw-semibold">{{ d.docNumber }}</td><td>{{ d.title }}</td><td>{{ t('docs.types.' + d.docType) }}</td><td>{{ d.revision }}</td><td class="text-end"><button v-if="d.fileId" class="btn btn-sm btn-light" @click="download(`/files/${d.fileId}`, { download: 1 }, d.docNumber)"><i class="fa-solid fa-download"></i></button></td></tr>
				</tbody>
			</table>
		</div>

		<!-- Historique -->
		<div v-else-if="tab === 'history'" class="card-is">
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('audit.when') }}</th><th>{{ t('audit.who') }}</th><th>{{ t('audit.action') }}</th><th>{{ t('audit.before') }}</th><th>{{ t('audit.after') }}</th></tr></thead>
				<tbody>
					<tr v-if="!history.length"><td colspan="5" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
					<tr v-for="h in history" :key="h.id"><td class="text-nowrap">{{ h.occurredAt.slice(0, 19) }}</td><td>{{ h.userEmail }}</td><td>{{ h.action }}</td><td><pre class="json">{{ fmt(h.before) }}</pre></td><td><pre class="json">{{ fmt(h.after) }}</pre></td></tr>
				</tbody>
			</table>
		</div>

		<AssetForm v-if="showForm" :asset="a" @close="showForm = false" @saved="showForm = false; loadAsset()" />
		<InspectionForm v-if="inspForm" :asset="assetObj" @close="inspForm = false; onInspSaved()" @saved="onInspSaved" @suggest="onSuggest" />
		<AnomalyForm v-if="anomalyForm" :draft="anomalyForm.priority ? anomalyForm : null" :asset="assetObj" @close="anomalyForm = null" @saved="anomalyForm = null; reload('anomalies', 'criticality'); tab = 'anomalies'" />
		<AnomalyDialog v-if="anomalyOpen" :id="anomalyOpen" @close="anomalyOpen = null" @changed="reload('anomalies', 'criticality')" />
	</div>
</template>

<style scoped>.grid-span { grid-column: 1 / -1; }</style>
