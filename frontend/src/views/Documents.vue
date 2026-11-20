<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api, download } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import Modal from '@/components/Modal.vue';
import ExportMenu from '@/components/ExportMenu.vue';
import Pager from '@/components/Pager.vue';

const { t } = useI18n();
const toast = useToast();
const items = ref([]);
const total = ref(0);
const page = ref(1);
const types = ref([]);
const type = ref('');
const q = ref('');
const detail = ref(null);
const form = ref(null);
const version = ref(null);
const file = ref(null);
let timer;

const query = computed(() => ({ type: type.value, q: q.value, facility: auth.facility }));
async function load() {
	await lookups.load();
	const r = await api('/documents', { query: { ...query.value, page: page.value, limit: 50 } });
	items.value = r.items; total.value = r.total; types.value = r.types;
}
onMounted(load);
watch([type, () => auth.facility], () => { page.value = 1; load(); });
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(page, load);

const canWrite = (facilityId) => (facilityId == null ? auth.user.isAdmin : auth.can(facilityId, 'engineer'));
const show = async (d) => { detail.value = await api(`/documents/${d.id}`); detail.value.facilityId = d.facilityId; };
const dl = (fileId, name) => download(`/files/${fileId}`, { download: 1 }, name);

const openNew = () => { file.value = null; form.value = { docNumber: '', title: '', docType: 'Report', facilityId: auth.facility || lookups.facilities.find((f) => auth.can(f.id, 'engineer'))?.id || '', revision: 'A', comment: '', tags: '' }; };
async function resolveTags(text, facilityId) {
	const tags = text.split(',').map((s) => s.trim()).filter(Boolean);
	const ids = [], unknown = [];
	for (const tag of tags) {
		const r = await api('/assets', { query: { q: tag, facility: facilityId, limit: 5 } });
		const hit = r.items.find((a) => a.tag.toLowerCase() === tag.toLowerCase());
		hit ? ids.push(hit.id) : unknown.push(tag);
	}
	return { ids, unknown };
}
async function create() {
	try {
		const { ids, unknown } = await resolveTags(form.value.tags, form.value.facilityId);
		if (unknown.length) toast.warning(t('docs.unknownTags', { t: unknown.join(', ') }));
		const fd = new FormData();
		for (const k of ['docNumber', 'title', 'docType', 'facilityId', 'revision', 'comment']) fd.append(k, form.value[k] ?? '');
		fd.append('assetIds', JSON.stringify(ids));
		if (file.value) fd.append('file', file.value);
		await api('/documents', { method: 'POST', form: fd });
		form.value = null; toast.success(t('docs.created')); load();
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
async function addVersion() {
	try {
		const fd = new FormData();
		fd.append('revision', version.value.revision); fd.append('comment', version.value.comment || '');
		fd.append('file', file.value);
		await api(`/documents/${detail.value.id}/versions`, { method: 'POST', form: fd });
		version.value = null; toast.success(t('docs.versionAdded')); const id = detail.value.id; const fid = detail.value.facilityId;
		detail.value = await api(`/documents/${id}`); detail.value.facilityId = fid; load();
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
</script>

<template>
	<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
		<h1 class="h4 mb-0 me-auto">{{ t('docs.title') }} <small class="text-muted fs-6">{{ t('common.total', { n: total }) }}</small></h1>
		<ExportMenu path="/documents" :query="query" name="documents" />
		<button v-if="auth.user.isAdmin || auth.canAny('engineer')" class="btn btn-primary btn-sm" @click="openNew"><i class="fa-solid fa-plus me-1"></i>{{ t('docs.new') }}</button>
	</div>
	<div class="card-is p-3 mb-3 d-flex flex-wrap gap-2 align-items-center">
		<input v-model="q" class="form-control form-control-sm" style="max-width: 240px" :placeholder="t('common.search')" />
		<select v-model="type" class="form-select form-select-sm" style="max-width: 200px"><option value="">{{ t('docs.type') }} : {{ t('common.all') }}</option><option v-for="x in types" :key="x" :value="x">{{ t('docs.types.' + x) }}</option></select>
	</div>
	<div class="card-is">
		<div class="table-responsive">
			<table class="table table-hover table-is mb-0">
				<thead><tr><th>{{ t('docs.number') }}</th><th>{{ t('docs.docTitle') }}</th><th>{{ t('docs.type') }}</th><th>{{ t('docs.revision') }}</th><th>{{ t('docs.linkedAssets') }}</th><th>{{ t('docs.updated') }}</th><th></th></tr></thead>
				<tbody>
					<tr v-if="!items.length"><td colspan="7" class="text-center text-muted py-4">{{ t('common.empty') }}</td></tr>
					<tr v-for="d in items" :key="d.id" class="clickable" @click="show(d)">
						<td class="fw-semibold">{{ d.docNumber }}</td><td>{{ d.title }}</td><td><span class="badge badge-class">{{ t('docs.types.' + d.docType) }}</span></td><td>{{ d.revision }}</td><td>{{ d.assets }}</td><td class="small">{{ String(d.updatedAt).slice(0, 10) }}</td>
						<td class="text-end" @click.stop><button v-if="d.fileId" class="btn btn-sm btn-light" :title="t('common.download')" @click="dl(d.fileId, d.docNumber)"><i class="fa-solid fa-download"></i></button></td>
					</tr>
				</tbody>
			</table>
		</div>
		<Pager v-model:page="page" :total="total" :limit="50" />
	</div>

	<Modal v-if="detail" :title="`${detail.docNumber} — ${detail.title}`" wide @close="detail = null">
		<div class="mb-3"><span class="badge badge-class me-2">{{ t('docs.types.' + detail.docType) }}</span> {{ t('docs.revision') }} <strong>{{ detail.revision }}</strong></div>
		<div class="mb-3"><span class="small text-muted me-2">{{ t('docs.linkedAssets') }}</span><router-link v-for="a in detail.assets" :key="a.id" :to="`/assets/${a.id}`" class="badge badge-class me-1 text-decoration-none" @click="detail = null">{{ a.tag }}</router-link></div>
		<h2 class="h6">{{ t('docs.versions') }}</h2>
		<table class="table table-sm table-is">
			<thead><tr><th>{{ t('docs.revision') }}</th><th>{{ t('common.date') }}</th><th>{{ t('docs.comment') }}</th><th>{{ t('docs.file') }}</th></tr></thead>
			<tbody><tr v-for="v in detail.versions" :key="v.id"><td class="fw-semibold">{{ v.revision }}</td><td class="small">{{ String(v.createdAt).slice(0, 16) }}</td><td class="small">{{ v.comment }}</td><td><a v-if="v.fileId" href="#" @click.prevent="dl(v.fileId, v.fileName)">{{ v.fileName }}</a><span v-else class="text-muted small">{{ t('docs.noFile') }}</span></td></tr></tbody>
		</table>
		<button v-if="canWrite(detail.facilityId)" class="btn btn-sm btn-outline-primary" @click="file = null; version = { revision: '', comment: '' }">{{ t('docs.newVersion') }}</button>
	</Modal>

	<Modal v-if="version" :title="t('docs.newVersion')" @close="version = null">
		<form id="verform" class="row g-3" @submit.prevent="addVersion">
			<div class="col-md-4"><label class="form-label">{{ t('docs.revision') }} *</label><input v-model="version.revision" class="form-control" maxlength="20" required /></div>
			<div class="col-md-8"><label class="form-label">{{ t('docs.comment') }}</label><input v-model="version.comment" class="form-control" maxlength="255" /></div>
			<div class="col-12"><label class="form-label">{{ t('docs.file') }} *</label><input type="file" class="form-control" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" required @change="file = $event.target.files[0]" /><div class="form-text">{{ t('docs.fileHelp') }}</div></div>
		</form>
		<template #footer><button class="btn btn-light" @click="version = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="verform" type="submit" :disabled="!file">{{ t('docs.newVersion') }}</button></template>
	</Modal>

	<Modal v-if="form" :title="t('docs.new')" wide @close="form = null">
		<form id="docform" class="row g-3" @submit.prevent="create">
			<div class="col-md-4"><label class="form-label">{{ t('docs.number') }} *</label><input v-model="form.docNumber" class="form-control" maxlength="80" required /></div>
			<div class="col-md-8"><label class="form-label">{{ t('docs.docTitle') }} *</label><input v-model="form.title" class="form-control" maxlength="255" required /></div>
			<div class="col-md-4"><label class="form-label">{{ t('docs.type') }}</label><select v-model="form.docType" class="form-select"><option v-for="x in types" :key="x" :value="x">{{ t('docs.types.' + x) }}</option></select></div>
			<div class="col-md-5"><label class="form-label">{{ t('assets.facility') }}</label><select v-model="form.facilityId" class="form-select"><option v-if="auth.user.isAdmin" value="">—</option><option v-for="f in lookups.facilities.filter((x) => auth.can(x.id, 'engineer'))" :key="f.id" :value="f.id">{{ f.name }}</option></select></div>
			<div class="col-md-3"><label class="form-label">{{ t('docs.revision') }}</label><input v-model="form.revision" class="form-control" maxlength="20" required /></div>
			<div class="col-12"><label class="form-label">{{ t('docs.linkedAssets') }}</label><input v-model="form.tags" class="form-control" :placeholder="t('docs.tagsHint')" /></div>
			<div class="col-12"><label class="form-label">{{ t('docs.file') }}</label><input type="file" class="form-control" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" @change="file = $event.target.files[0]" /><div class="form-text">{{ t('docs.fileHelp') }}</div></div>
		</form>
		<template #footer><button class="btn btn-light" @click="form = null">{{ t('common.cancel') }}</button><button class="btn btn-primary" form="docform" type="submit">{{ t('common.create') }}</button></template>
	</Modal>
</template>
