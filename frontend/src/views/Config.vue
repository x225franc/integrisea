<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api, apiImport, download } from '@/api';
import { lookups } from '@/stores/lookups';
import { settings } from '@/stores/settings';
import Modal from '@/components/Modal.vue';
import RiskMatrix from '@/components/RiskMatrix.vue';
import ProvisionalBadge from '@/components/ProvisionalBadge.vue';

const { t } = useI18n();
const toast = useToast();
const tab = ref('classes');
const tabs = ['classes', 'matrix', 'stress', 'templates', 'scales', 'priorities', 'gmao'];

// --- Classes et attributs ---
const attrs = ref([]);
const cm = ref(null);
const am = ref(null);
// --- Paramètres du moteur (copie locale éditable) ---
const cfg = ref(null);
const templates = ref([]);
const tm = ref(null);
const stressMats = ref([]); // [{ material, family, fictitious, points: [{ tempC, s }] }]
const structRows = ref([]); // plages de diamètre des tuyauteries : [{ maxOdMm ('' = au-delà), min }]
const disciplinesText = ref('');
const imp = ref(null); // import de la table des contraintes : { file, preview, errors }
const classMaxRows = ref([]);
const fluidRows = ref([]);
const gmaoFacility = ref('');

const LEVELS = ['L', 'M', 'MH', 'H'];
const clone = (x) => JSON.parse(JSON.stringify(x));

async function loadAll() {
	await lookups.load(true);
	attrs.value = await api('/attributes');
	cfg.value = clone(await settings.load(true));
	stressMats.value = Object.entries(cfg.value.allowableStress).map(([material, e]) => ({ material, family: cfg.value.materialFamilies[material] ?? '', fictitious: !!e.fictitious, points: e.points.map((p) => ({ ...p })) }));
	structRows.value = cfg.value.structuralMin.pipe.map((r) => ({ maxOdMm: r.maxOdMm ?? '', min: r.min }));
	disciplinesText.value = cfg.value.disciplines.join('\n');
	classMaxRows.value = Object.entries(cfg.value.classMaxInterval).map(([cls, months]) => ({ cls, months }));
	fluidRows.value = Object.entries(cfg.value.fluidCriticality).map(([fluid, v]) => ({ fluid, s: v[0], e: v[1], p: v[2] }));
	templates.value = await api('/inspections/templates');
	gmaoFacility.value = gmaoFacility.value || lookups.facilities[0]?.id || '';
}
onMounted(loadAll);

async function saveKey(key, value) {
	try { await api(`/settings/${key}`, { method: 'PUT', body: { value } }); await settings.load(true); toast.success(t('cfg.saved')); }
	catch (e) { toast.error(e.details?.map((d) => d.message).join(' ; ') || e.message); }
}

// Classes
const openClass = (c) => (cm.value = c ? { ...c, isNew: false } : { isNew: true, code: '', nameFr: '', nameEn: '', tracking: 'condition', cfihosCode: '', defaultDiscipline: '', isActive: true, sortOrder: 100 });
async function saveClass() {
	const c = cm.value;
	try {
		await api(c.isNew ? '/classes' : `/classes/${c.code}`, { method: c.isNew ? 'POST' : 'PUT', body: { code: c.code, nameFr: c.nameFr, nameEn: c.nameEn, tracking: c.tracking, cfihosCode: c.cfihosCode, defaultDiscipline: c.defaultDiscipline, isActive: c.isActive, sortOrder: c.sortOrder } });
		cm.value = null; toast.success(t('common.saved')); loadAll();
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function saveAttr() {
	try { await api('/attributes', { method: 'POST', body: am.value }); am.value = null; toast.success(t('common.saved')); loadAll(); }
	catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function delAttr(a) { if (confirm(t('common.delete') + ' ?')) { await api(`/attributes/${a.id}`, { method: 'DELETE' }); loadAll(); } }

// Matrice
const cycle = ({ pof, cof }) => { const m = cfg.value.matrix; m[pof - 1][cof - 1] = LEVELS[(LEVELS.indexOf(m[pof - 1][cof - 1]) + 1) % LEVELS.length]; };
const saveMatrix = () => saveKey('matrix', cfg.value.matrix);
const saveIntervals = async () => { await saveKey('intervals', Object.fromEntries(LEVELS.map((l) => [l, Number(cfg.value.intervals[l])]))); };
const saveClassMax = () => saveKey('classMaxInterval', Object.fromEntries(classMaxRows.value.filter((r) => r.cls).map((r) => [r.cls.toUpperCase(), Number(r.months)])));
const saveThresholds = () => saveKey('pofThresholds', cfg.value.pofThresholds.map(Number));
// Matériaux
async function saveStress() {
	const mats = stressMats.value.filter((m) => m.material.trim());
	const table = Object.fromEntries(mats.map((m) => [m.material.trim(), {
		...(m.fictitious ? { fictitious: true } : {}),
		points: m.points.filter((p) => p.tempC !== '' && p.s !== '').map((p) => ({ tempC: Number(p.tempC), s: Number(p.s) })).sort((a, b) => a.tempC - b.tempC),
	}]));
	const families = Object.fromEntries(mats.filter((m) => m.family).map((m) => [m.material.trim(), m.family]));
	await saveKey('materialFamilies', families);
	await saveKey('allowableStress', table);
	await loadAll();
}
const addMaterial = () => stressMats.value.push({ material: '', family: '', fictitious: false, points: [{ tempC: '', s: '' }] });
const saveFloors = () => saveKey('corrosionFloors', Object.fromEntries(Object.entries(cfg.value.corrosionFloors).map(([k, v]) => [k, Number(v)])));
const saveFormulas = () => saveKey('classFormula', cfg.value.classFormula);
const addRange = () => structRows.value.splice(Math.max(0, structRows.value.length - 1), 0, { maxOdMm: '', min: '' });
const saveStruct = () => saveKey('structuralMin', {
	pipe: structRows.value.map((r, i) => ({ maxOdMm: i === structRows.value.length - 1 ? null : Number(r.maxOdMm), min: Number(r.min) })),
	vessel: Number(cfg.value.structuralMin.vessel),
});
const saveDefaultPof = () => saveKey('defaultPof', Object.fromEntries(Object.entries(cfg.value.defaultPof).map(([k, v]) => [k, Number(v)])));
const saveGradePof = () => saveKey('gradeToPof', cfg.value.gradeToPof.map(Number));
const saveDisciplines = () => saveKey('disciplines', disciplinesText.value.split('\n').map((s) => s.trim()).filter(Boolean));
// Import / export de la table des contraintes (Excel ou CSV)
const exportStress = (format) => download('/settings/allowable-stress/export', { format }, `contraintes-admissibles.${format}`).catch((e) => toast.error(e.message));
async function pickStressFile(ev) {
	const file = ev.target.files?.[0];
	ev.target.value = '';
	if (!file) return;
	try { imp.value = { file, ...(await apiImport(file, { dryRun: true }, '/settings/allowable-stress/import')) }; }
	catch (e) { toast.error(e.message); }
}
async function applyStressImport() {
	try { await apiImport(imp.value.file, { dryRun: false }, '/settings/allowable-stress/import'); imp.value = null; await settings.load(true); toast.success(t('cfg.saved')); loadAll(); }
	catch (e) { toast.error(e.message); }
}
// Échelles et fluides
const saveFluids = () => saveKey('fluidCriticality', Object.fromEntries(fluidRows.value.filter((r) => r.fluid.trim()).map((r) => [r.fluid.trim(), [Number(r.s), Number(r.e), Number(r.p)]])));
const saveScales = () => saveKey('consequenceScales', cfg.value.consequenceScales);
// Priorités et seuils
const savePriorities = () => saveKey('priorityDays', Object.fromEntries(Object.entries(cfg.value.priorityDays).map(([k, v]) => [k, Number(v)])));
const saveSuggestion = () => saveKey('anomalySuggestion', cfg.value.anomalySuggestion);
const saveNumber = (k) => saveKey(k, Number(cfg.value[k]));

// Gabarits
const openTpl = (x) => (tm.value = x
	? { isNew: false, id: x.id, name: x.name, classes: x.classes.join(', '), isActive: x.isActive, json: JSON.stringify({ fields: x.fields, rules: x.rules }, null, 2) }
	: { isNew: true, id: '', name: '', classes: '', isActive: true, json: JSON.stringify({ fields: [{ k: 'grade', l: 'Condition grade', t: 'grade' }, { k: 'notes', l: 'Findings', t: 'textarea' }], rules: [] }, null, 2) });
async function saveTpl() {
	let parsed;
	try { parsed = JSON.parse(tm.value.json); } catch { toast.error(t('cfg.jsonInvalid')); return; }
	const body = { id: tm.value.id, name: tm.value.name, classes: tm.value.classes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean), isActive: tm.value.isActive, fields: parsed.fields, rules: parsed.rules ?? [] };
	try { await api(tm.value.isNew ? '/settings/templates' : `/settings/templates/${tm.value.id}`, { method: tm.value.isNew ? 'POST' : 'PUT', body }); tm.value = null; toast.success(t('cfg.saved')); loadAll(); }
	catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
// GMAO
const exportMaximo = (kind, format) => download(`/export/maximo/${kind}`, { facility: gmaoFacility.value, format }, `maximo-${kind}.${format}`).catch((e) => toast.error(e.message));
async function recompute() { await api('/rbi/recompute', { method: 'POST' }); toast.success(t('cfg.recomputed')); }

const demoStress = computed(() => stressMats.value.some((m) => m.fictitious));
const provisionalCount = computed(() => settings.data?._meta?.provisional?.length ?? 0);
</script>

<template>
	<h1 class="h4 mb-3">{{ t('config.title') }}</h1>
	<ul class="nav nav-tabs mb-3 flex-nowrap overflow-auto">
		<li v-for="k in tabs" :key="k" class="nav-item"><a class="nav-link text-nowrap" :class="{ active: tab === k }" href="#" @click.prevent="tab = k">{{ t('cfg.tabs.' + k) }}</a></li>
	</ul>

	<div v-if="provisionalCount" class="alert alert-warning py-2 small d-flex align-items-center gap-2"><i class="fa-solid fa-flask"></i><span>{{ t('prov.summary', { n: provisionalCount }) }} {{ t('prov.hint') }}</span></div>

	<div v-if="cfg">
		<!-- Classes et attributs -->
		<div v-if="tab === 'classes'">
			<div class="card-is mb-4">
				<div class="p-3 d-flex border-bottom align-items-center"><strong class="me-auto">{{ t('config.classes') }}</strong><button class="btn btn-primary btn-sm" @click="openClass()"><i class="fa-solid fa-plus me-1"></i>{{ t('config.newClass') }}</button></div>
				<table class="table table-sm table-is mb-0">
					<thead><tr><th>Code</th><th>{{ t('config.nameFr') }}</th><th>{{ t('config.nameEn') }}</th><th>{{ t('config.tracking') }}</th><th>{{ t('cfg.defaultDiscipline') }}</th><th>{{ t('config.cfihos') }}</th><th>{{ t('config.active') }}</th><th></th></tr></thead>
					<tbody><tr v-for="c in lookups.classes" :key="c.code" :class="{ 'text-muted': !c.isActive }">
						<td class="fw-semibold">{{ c.code }}</td><td>{{ c.nameFr }}</td><td>{{ c.nameEn }}</td><td>{{ t('config.' + c.tracking) }}</td><td class="small">{{ c.defaultDiscipline || t('common.none') }}<span v-if="c.code === 'EX'" class="badge text-bg-warning ms-1">{{ t('prov.badge') }}</span></td><td>{{ c.cfihosCode || t('common.none') }}</td><td>{{ c.isActive ? t('common.yes') : t('common.no') }}</td>
						<td class="text-end"><button class="btn btn-sm btn-light" @click="openClass(c)"><i class="fa-solid fa-pen"></i></button></td>
					</tr></tbody>
				</table>
			</div>
			<div class="card-is mb-4 p-3">
				<h2 class="h6 d-flex align-items-center gap-2">{{ t('cfg.disciplines') }} <ProvisionalBadge k="disciplines" editable @changed="loadAll" /></h2>
				<p class="text-muted small">{{ t('cfg.disciplinesHint') }}</p>
				<textarea v-model="disciplinesText" class="form-control form-control-sm mb-2" rows="4" style="max-width: 320px"></textarea>
				<button class="btn btn-primary btn-sm" @click="saveDisciplines">{{ t('cfg.save') }}</button>
			</div>
			<div class="card-is">
				<div class="p-3 d-flex border-bottom align-items-center"><strong class="me-auto">{{ t('config.attributes') }}</strong><button class="btn btn-primary btn-sm" @click="am = { classCode: '', attrKey: '', labelFr: '', labelEn: '', dataType: 'text', cfihosRef: '' }"><i class="fa-solid fa-plus me-1"></i>{{ t('config.newAttr') }}</button></div>
				<table class="table table-sm table-is mb-0">
					<thead><tr><th>{{ t('config.key') }}</th><th>{{ t('config.nameFr') }}</th><th>{{ t('config.nameEn') }}</th><th>{{ t('config.type') }}</th><th>{{ t('assets.class') }}</th><th>CFIHOS</th><th></th></tr></thead>
					<tbody>
						<tr v-if="!attrs.length"><td colspan="7" class="text-center text-muted py-3">{{ t('common.empty') }}</td></tr>
						<tr v-for="a in attrs" :key="a.id"><td>{{ a.attrKey }}</td><td>{{ a.labelFr }}</td><td>{{ a.labelEn }}</td><td>{{ a.dataType }}</td><td>{{ a.classCode || t('common.all') }}</td><td>{{ a.cfihosRef || t('common.none') }}</td><td class="text-end"><button class="btn btn-sm btn-light text-danger" @click="delAttr(a)"><i class="fa-solid fa-trash"></i></button></td></tr>
					</tbody>
				</table>
			</div>
		</div>

		<!-- Matrice et intervalles -->
		<div v-else-if="tab === 'matrix'" class="row g-3">
			<div class="col-xl-5"><div class="card-is p-3">
				<h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('dash.matrix') }} <ProvisionalBadge k="matrix" editable @changed="loadAll" /></h2><p class="text-muted small">{{ t('cfg.matrixHint') }}</p>
				<RiskMatrix :matrix="cfg.matrix" editable @toggle="cycle" />
				<div class="d-flex gap-2 mt-3 align-items-center"><span v-for="l in LEVELS" :key="l" class="risk-badge" :class="`risk-${l}`">{{ l }} {{ t('risk.' + l) }}</span></div>
				<button class="btn btn-primary btn-sm mt-3" @click="saveMatrix">{{ t('cfg.save') }}</button>
			</div></div>
			<div class="col-xl-7">
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.intervals') }} <ProvisionalBadge k="intervals" editable @changed="loadAll" /></h2>
					<div class="row g-2"><div v-for="l in LEVELS" :key="l" class="col-3"><label class="form-label small"><span class="risk-badge" :class="`risk-${l}`">{{ l }}</span></label><input v-model="cfg.intervals[l]" type="number" min="0" class="form-control form-control-sm" /></div></div>
					<button class="btn btn-primary btn-sm mt-3" @click="saveIntervals">{{ t('cfg.save') }}</button></div>
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.classMax') }} <ProvisionalBadge k="classMaxInterval" editable @changed="loadAll" /></h2>
					<div v-for="(r, i) in classMaxRows" :key="i" class="d-flex gap-2 mb-2"><select v-model="r.cls" class="form-select form-select-sm" style="max-width: 160px"><option v-for="c in lookups.classes" :key="c.code" :value="c.code">{{ c.code }}</option></select><input v-model="r.months" type="number" min="0" class="form-control form-control-sm" style="max-width: 120px" /><button class="btn btn-sm btn-light text-danger" @click="classMaxRows.splice(i, 1)"><i class="fa-solid fa-xmark"></i></button></div>
					<button class="btn btn-sm btn-outline-secondary me-2" @click="classMaxRows.push({ cls: lookups.classes[0]?.code, months: 36 })">{{ t('cfg.addRow') }}</button><button class="btn btn-primary btn-sm" @click="saveClassMax">{{ t('cfg.save') }}</button></div>
				<div class="card-is p-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.pofThresholds') }} <ProvisionalBadge k="pofThresholds" editable @changed="loadAll" /></h2>
					<div class="row g-2"><div v-for="i in 4" :key="i" class="col-3"><label class="form-label small">PoF {{ i }}</label><input v-model="cfg.pofThresholds[i - 1]" type="number" min="0" step="0.5" class="form-control form-control-sm" /></div></div>
					<button class="btn btn-primary btn-sm mt-3" @click="saveThresholds">{{ t('cfg.save') }}</button></div>
			</div>
		</div>

		<!-- Matériaux et formules -->
		<div v-else-if="tab === 'stress'" class="row g-3">
			<div class="col-xl-6">
				<div class="card-is p-3 mb-3">
					<h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.stress') }} <ProvisionalBadge k="allowableStress" editable @changed="loadAll" /></h2>
					<p class="text-muted small mb-2">{{ t('cfg.stressHint') }}</p>
					<div v-if="!stressMats.length" class="alert alert-warning py-2 small">{{ t('cfg.stressEmpty') }}</div>
					<div v-else-if="demoStress" class="alert alert-info py-2 small"><span class="badge text-bg-info me-1">{{ t('prov.fictitious') }}</span>{{ t('cfg.stressDemo') }}</div>
					<div v-for="(m, mi) in stressMats" :key="mi" class="border rounded p-2 mb-2">
						<div class="d-flex gap-2 mb-2 align-items-center">
							<input v-model="m.material" class="form-control form-control-sm fw-semibold" :placeholder="t('cfg.material')" />
							<select v-model="m.family" class="form-select form-select-sm" style="max-width: 190px" :title="t('cfg.family')"><option value="">{{ t('cfg.family') }} : —</option><option value="carbon">{{ t('cfg.familyCarbon') }}</option><option value="cra">{{ t('cfg.familyCra') }}</option></select>
							<span v-if="m.fictitious" class="badge text-bg-info">{{ t('cfg.fictitiousBadge') }}</span>
							<button class="btn btn-sm btn-light text-danger" @click="stressMats.splice(mi, 1)"><i class="fa-solid fa-trash"></i></button>
						</div>
						<div class="d-flex gap-2 small text-muted mb-1"><span style="width:110px">{{ t('cfg.tempC') }}</span><span style="width:110px">{{ t('cfg.sMpa') }}</span></div>
						<div v-for="(p, pi) in m.points" :key="pi" class="d-flex gap-2 mb-1">
							<input v-model="p.tempC" type="number" step="any" class="form-control form-control-sm" style="width: 110px" />
							<input v-model="p.s" type="number" min="0" step="any" class="form-control form-control-sm" style="width: 110px" />
							<button class="btn btn-sm btn-light text-danger" :disabled="m.points.length === 1" @click="m.points.splice(pi, 1)"><i class="fa-solid fa-xmark"></i></button>
						</div>
						<button class="btn btn-sm btn-link p-0" @click="m.points.push({ tempC: '', s: '' })">{{ t('cfg.addPoint') }}</button>
					</div>
					<div class="d-flex flex-wrap gap-2 mt-2">
						<button class="btn btn-sm btn-outline-secondary" @click="addMaterial">{{ t('cfg.addMaterial') }}</button>
						<button class="btn btn-primary btn-sm" @click="saveStress">{{ t('cfg.save') }}</button>
						<span class="ms-auto d-flex gap-2">
							<label class="btn btn-sm btn-outline-secondary mb-0"><i class="fa-solid fa-upload me-1"></i>{{ t('cfg.importStress') }}<input type="file" accept=".csv,.xlsx" class="d-none" @change="pickStressFile" /></label>
							<span class="dropdown"><button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown"><i class="fa-solid fa-download me-1"></i>{{ t('cfg.exportStress') }}</button>
								<ul class="dropdown-menu"><li><a class="dropdown-item" href="#" @click.prevent="exportStress('xlsx')">Excel (.xlsx)</a></li><li><a class="dropdown-item" href="#" @click.prevent="exportStress('csv')">CSV</a></li></ul></span>
						</span>
					</div>
				</div>
				<div class="card-is p-3">
					<h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.corrosionFloors') }} <ProvisionalBadge k="corrosionFloors" editable @changed="loadAll" /></h2>
					<p class="text-muted small mb-2">{{ t('cfg.floorHint') }}</p>
					<div class="row g-2">
						<div class="col-6"><label class="form-label small">{{ t('cfg.floorCarbon') }}</label><input v-model="cfg.corrosionFloors.carbon" type="number" min="0" step="any" class="form-control form-control-sm" /></div>
						<div class="col-6"><label class="form-label small">{{ t('cfg.floorCra') }}</label><input v-model="cfg.corrosionFloors.cra" type="number" min="0" step="any" class="form-control form-control-sm" /></div>
					</div>
					<button class="btn btn-primary btn-sm mt-3" @click="saveFloors">{{ t('cfg.save') }}</button>
				</div>
			</div>
			<div class="col-xl-6">
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.formulas') }} <ProvisionalBadge k="classFormula" editable @changed="loadAll" /></h2>
					<div class="row g-2"><div v-for="c in lookups.classes.filter((x) => x.tracking === 'thickness')" :key="c.code" class="col-6 col-md-3"><label class="form-label small">{{ c.code }}</label><select v-model="cfg.classFormula[c.code]" class="form-select form-select-sm"><option value="pipe">{{ t('cfg.pipe') }}</option><option value="vessel">{{ t('cfg.vessel') }}</option></select></div></div>
					<button class="btn btn-primary btn-sm mt-3" @click="saveFormulas">{{ t('cfg.save') }}</button></div>
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.structMin') }} <ProvisionalBadge k="structuralMin" editable @changed="loadAll" /></h2>
					<p class="text-muted small mb-2">{{ t('cfg.structHint') }}</p>
					<div class="d-flex gap-2 small text-muted mb-1"><span style="flex:1">{{ t('cfg.odUpTo') }}</span><span style="width:110px">{{ t('cfg.minMm') }}</span><span style="width:30px"></span></div>
					<div v-for="(r, i) in structRows" :key="i" class="d-flex gap-2 mb-1 align-items-center">
						<input v-if="i < structRows.length - 1" v-model="r.maxOdMm" type="number" min="0" step="any" class="form-control form-control-sm" style="flex:1" />
						<span v-else class="form-control form-control-sm bg-light text-muted" style="flex:1">{{ t('cfg.beyond') }}</span>
						<input v-model="r.min" type="number" min="0" step="0.1" class="form-control form-control-sm" style="width: 110px" />
						<button class="btn btn-sm btn-light text-danger" :disabled="structRows.length < 2 || i === structRows.length - 1" @click="structRows.splice(i, 1)"><i class="fa-solid fa-xmark"></i></button>
					</div>
					<button class="btn btn-sm btn-link p-0 mb-2" @click="addRange">{{ t('cfg.addRange') }}</button>
					<div class="row g-2"><div class="col-6"><label class="form-label small">{{ t('cfg.vesselMin') }}</label><input v-model="cfg.structuralMin.vessel" type="number" step="0.1" class="form-control form-control-sm" /></div></div>
					<button class="btn btn-primary btn-sm mt-3" @click="saveStruct">{{ t('cfg.save') }}</button></div>
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.defaultPofTitle') }} <ProvisionalBadge k="defaultPof" editable @changed="loadAll" /></h2>
					<div class="d-flex flex-wrap gap-2 align-items-end">
						<div><label class="form-label small">{{ t('cfg.defaultPofFrom') }}</label><input v-model="cfg.defaultPof.cofFrom" type="number" min="1" max="5" class="form-control form-control-sm" style="width: 80px" /></div>
						<div><label class="form-label small">{{ t('cfg.defaultPofHigh') }}</label><input v-model="cfg.defaultPof.high" type="number" min="1" max="5" class="form-control form-control-sm" style="width: 80px" /></div>
						<div><label class="form-label small">{{ t('cfg.defaultPofLow') }}</label><input v-model="cfg.defaultPof.low" type="number" min="1" max="5" class="form-control form-control-sm" style="width: 80px" /></div>
						<button class="btn btn-primary btn-sm" @click="saveDefaultPof">{{ t('cfg.save') }}</button>
					</div></div>
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.gradePof') }} <ProvisionalBadge k="gradeToPof" editable @changed="loadAll" /></h2>
					<div class="d-flex flex-wrap gap-2 align-items-end">
						<div v-for="g in 4" :key="g"><label class="form-label small">{{ t('cfg.gradeN', { g }) }} → PoF</label><input v-model="cfg.gradeToPof[g - 1]" type="number" min="1" max="5" class="form-control form-control-sm" style="width: 80px" /></div>
						<button class="btn btn-primary btn-sm" @click="saveGradePof">{{ t('cfg.save') }}</button>
					</div></div>
				<div class="card-is p-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.defaultCof') }} <ProvisionalBadge k="defaultConsequence" editable @changed="loadAll" /></h2>
					<p class="text-muted small mb-2">{{ t('cfg.defaultCofHint') }}</p>
					<div class="d-flex gap-2 align-items-center"><input v-model="cfg.defaultConsequence" type="number" min="1" max="5" class="form-control form-control-sm" style="width: 80px" /><button class="btn btn-primary btn-sm" @click="saveNumber('defaultConsequence')">{{ t('cfg.save') }}</button></div></div>
			</div>
		</div>

		<!-- Gabarits -->
		<div v-else-if="tab === 'templates'" class="card-is">
			<div class="p-3 d-flex border-bottom align-items-center"><span class="text-muted small me-auto">{{ t('cfg.templatesHint') }}</span><button class="btn btn-primary btn-sm" @click="openTpl()"><i class="fa-solid fa-plus me-1"></i>{{ t('cfg.newTemplate') }}</button></div>
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>ID</th><th>{{ t('cfg.templateName') }}</th><th>{{ t('assets.class') }}</th><th>{{ t('config.active') }}</th><th></th><th></th></tr></thead>
				<tbody><tr v-for="x in templates" :key="x.id" :class="{ 'text-muted': !x.isActive }"><td class="fw-semibold">{{ x.id }}</td><td>{{ x.name }}</td><td><span v-for="c in x.classes" :key="c" class="badge badge-class me-1">{{ c }}</span></td><td>{{ x.isActive ? t('common.yes') : t('common.no') }}</td><td><ProvisionalBadge :k="`template:${x.id}`" editable @changed="loadAll" /></td><td class="text-end"><button class="btn btn-sm btn-light" @click="openTpl(x)"><i class="fa-solid fa-pen"></i></button></td></tr></tbody>
			</table>
		</div>

		<!-- Conséquences et criticité -->
		<div v-else-if="tab === 'scales'" class="row g-3">
			<div class="col-lg-5"><div class="card-is p-3">
				<h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.fluids') }} <ProvisionalBadge k="fluidCriticality" editable @changed="loadAll" /></h2>
				<div class="d-flex gap-2 small text-muted mb-1"><span style="flex:1">{{ t('cfg.fluid') }}</span><span style="width:54px">S</span><span style="width:54px">E</span><span style="width:54px">P</span><span style="width:30px"></span></div>
				<div v-for="(r, i) in fluidRows" :key="i" class="d-flex gap-2 mb-2"><input v-model="r.fluid" class="form-control form-control-sm" /><input v-for="k in ['s', 'e', 'p']" :key="k" v-model="r[k]" type="number" min="1" max="5" class="form-control form-control-sm" style="width: 54px" /><button class="btn btn-sm btn-light text-danger" @click="fluidRows.splice(i, 1)"><i class="fa-solid fa-xmark"></i></button></div>
				<button class="btn btn-sm btn-outline-secondary me-2" @click="fluidRows.push({ fluid: '', s: 3, e: 3, p: 3 })">{{ t('cfg.addRow') }}</button><button class="btn btn-primary btn-sm" @click="saveFluids">{{ t('cfg.save') }}</button>
			</div></div>
			<div class="col-lg-7"><div class="card-is p-3">
				<h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.scalesTitle') }} <ProvisionalBadge k="consequenceScales" editable @changed="loadAll" /></h2>
				<div v-for="ax in ['s', 'e', 'p']" :key="ax" class="mb-3">
					<div class="fw-semibold small mb-1">{{ t('crit.score' + ax.toUpperCase()) }}</div>
					<div v-for="i in 5" :key="i" class="d-flex gap-2 mb-1 align-items-center"><span class="fw-bold" style="width: 14px">{{ i }}</span><input v-model="cfg.consequenceScales[ax].fr[i - 1]" class="form-control form-control-sm" placeholder="FR" /><input v-model="cfg.consequenceScales[ax].en[i - 1]" class="form-control form-control-sm" placeholder="EN" /></div>
				</div>
				<button class="btn btn-primary btn-sm" @click="saveScales">{{ t('cfg.save') }}</button>
			</div></div>
		</div>

		<!-- Priorités et seuils -->
		<div v-else-if="tab === 'priorities'" class="row g-3">
			<div class="col-lg-6">
				<div class="card-is p-3 mb-3"><h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('cfg.priorityDays') }} <ProvisionalBadge k="priorityDays" editable @changed="loadAll" /></h2>
					<div class="row g-2"><div v-for="p in ['P1', 'P2', 'P3', 'P4']" :key="p" class="col-3"><label class="form-label small">{{ p }}</label><input v-model="cfg.priorityDays[p]" type="number" min="1" class="form-control form-control-sm" /></div></div>
					<button class="btn btn-primary btn-sm mt-3" @click="savePriorities">{{ t('cfg.save') }}</button></div>
				<div class="card-is p-3"><h2 class="h6">{{ t('cfg.thresholds') }}</h2>
					<div v-for="k in [['dueSoonDays', 'dueSoon'], ['repairAlertDays', 'repairAlert'], ['endOfLifeRlYears', 'endOfLife'], ['minShortTermYears', 'minShort'], ['minLongTermYears', 'minLong']]" :key="k[0]" class="d-flex gap-2 mb-2 align-items-center">
						<label class="small flex-grow-1">{{ t('cfg.' + k[1]) }} <ProvisionalBadge :k="k[0]" editable @changed="loadAll" /></label><input v-model="cfg[k[0]]" type="number" step="any" class="form-control form-control-sm" style="max-width: 100px" /><button class="btn btn-sm btn-primary" @click="saveNumber(k[0])">{{ t('cfg.save') }}</button>
					</div></div>
			</div>
			<div class="col-lg-6"><div class="card-is p-3">
				<h2 class="h6 d-flex align-items-center gap-2 flex-wrap">{{ t('insp.suggestTitle') }} <ProvisionalBadge k="anomalySuggestion" editable @changed="loadAll" /></h2>
				<div v-for="k in ['belowTmin', 'rlUnder2', 'rlUnder5', 'grade4', 'grade3']" :key="k" class="d-flex gap-2 mb-2 align-items-center"><label class="small flex-grow-1">{{ t('cfg.sugg.' + k) }}</label><select v-model="cfg.anomalySuggestion[k]" class="form-select form-select-sm" style="max-width: 90px"><option v-for="p in ['P1', 'P2', 'P3', 'P4']" :key="p" :value="p">{{ p }}</option></select></div>
				<button class="btn btn-primary btn-sm mt-2" @click="saveSuggestion">{{ t('cfg.save') }}</button>
			</div></div>
		</div>

		<!-- GMAO -->
		<div v-else-if="tab === 'gmao'" class="card-is p-4">
			<h2 class="h6">{{ t('cfg.gmaoTitle') }}</h2>
			<p class="text-muted small">{{ t('cfg.gmaoHint') }}</p>
			<div class="d-flex flex-wrap gap-2 align-items-center mb-3">
				<select v-model="gmaoFacility" class="form-select form-select-sm" style="max-width: 260px"><option value="">{{ t('nav.allFacilities') }}</option><option v-for="f in lookups.facilities" :key="f.id" :value="f.id">{{ f.name }}</option></select>
			</div>
			<div class="d-flex flex-wrap gap-2 mb-4">
				<button class="btn btn-outline-primary btn-sm" @click="exportMaximo('assets', 'xlsx')"><i class="fa-solid fa-file-excel me-1"></i>{{ t('cfg.gmaoAssets') }} (.xlsx)</button>
				<button class="btn btn-outline-primary btn-sm" @click="exportMaximo('assets', 'csv')">{{ t('cfg.gmaoAssets') }} (CSV)</button>
				<button class="btn btn-outline-primary btn-sm" @click="exportMaximo('pm', 'xlsx')"><i class="fa-solid fa-file-excel me-1"></i>{{ t('cfg.gmaoPm') }} (.xlsx)</button>
				<button class="btn btn-outline-primary btn-sm" @click="exportMaximo('pm', 'csv')">{{ t('cfg.gmaoPm') }} (CSV)</button>
			</div>
			<hr />
			<button class="btn btn-outline-secondary btn-sm" @click="recompute"><i class="fa-solid fa-rotate me-1"></i>{{ t('cfg.recompute') }}</button>
		</div>
	</div>

	<Modal v-if="imp" :title="t('cfg.importTitle')" @close="imp = null">
		<p class="small text-muted">{{ t('cfg.importHint') }}</p>
		<div v-if="imp.errors?.length" class="alert alert-danger py-2 small">
			<div class="fw-semibold mb-1">{{ t('cfg.importErrors') }}</div>
			<div v-for="(e, i) in imp.errors.slice(0, 30)" :key="i">{{ t('cfg.importLine', { line: e.line }) }} : {{ e.message }}</div>
		</div>
		<div v-else class="alert alert-success py-2 small">{{ t('cfg.importPreview', { materials: imp.materials, points: imp.points }) }}</div>
		<template #footer>
			<button class="btn btn-light" @click="imp = null">{{ t('common.cancel') }}</button>
			<button class="btn btn-primary" :disabled="!!imp.errors?.length" @click="applyStressImport">{{ t('cfg.replaceTable') }}</button>
		</template>
	</Modal>

	<Modal v-if="cm" :title="cm.isNew ? t('config.newClass') : cm.code" @close="cm = null">
		<form id="clsform" class="row g-3" @submit.prevent="saveClass">
			<div class="col-md-4"><label class="form-label">Code</label><input v-model="cm.code" class="form-control" maxlength="20" :disabled="!cm.isNew" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.nameFr') }}</label><input v-model="cm.nameFr" class="form-control" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.nameEn') }}</label><input v-model="cm.nameEn" class="form-control" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.tracking') }}</label><select v-model="cm.tracking" class="form-select"><option value="thickness">{{ t('config.thickness') }}</option><option value="condition">{{ t('config.condition') }}</option></select></div>
			<div class="col-md-4"><label class="form-label">{{ t('config.cfihos') }}</label><input v-model="cm.cfihosCode" class="form-control" /></div>
			<div class="col-md-4"><label class="form-label">{{ t('cfg.defaultDiscipline') }}</label><select v-model="cm.defaultDiscipline" class="form-select"><option value="">{{ t('common.none') }}</option><option v-for="d in lookups.disciplines" :key="d" :value="d">{{ d }}</option></select></div>
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

	<Modal v-if="tm" :title="tm.isNew ? t('cfg.newTemplate') : tm.id" wide @close="tm = null">
		<form id="tplform" class="row g-3" @submit.prevent="saveTpl">
			<div class="col-md-3"><label class="form-label">{{ t('cfg.templateId') }}</label><input v-model="tm.id" class="form-control" :disabled="!tm.isNew" pattern="[A-Z][A-Z0-9_]*" required /></div>
			<div class="col-md-9"><label class="form-label">{{ t('cfg.templateName') }}</label><input v-model="tm.name" class="form-control" required /></div>
			<div class="col-md-9"><label class="form-label">{{ t('cfg.classes') }}</label><input v-model="tm.classes" class="form-control" required /></div>
			<div class="col-md-3 pt-md-4"><div class="form-check"><input id="ta" v-model="tm.isActive" type="checkbox" class="form-check-input" /><label for="ta" class="form-check-label">{{ t('cfg.active') }}</label></div></div>
			<div class="col-12"><label class="form-label">{{ t('cfg.templateJson') }}</label><textarea v-model="tm.json" class="form-control font-monospace" rows="14" spellcheck="false"></textarea><div class="form-text">{{ t('cfg.templatesTip') }}</div></div>
		</form>
		<template #footer><button class="btn btn-light" @click="tm = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="tplform" type="submit">{{ t('common.save') }}</button></template>
	</Modal>
</template>
