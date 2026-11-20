<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { apiImport, download } from '@/api';
import Modal from './Modal.vue';

const emit = defineEmits(['close', 'done']);
const { t } = useI18n();
const toast = useToast();
const file = ref(null);
const partial = ref(false);
const result = ref(null);
const busy = ref(false);

async function run(dryRun) {
	if (!file.value) return;
	busy.value = true;
	try {
		const r = await apiImport(file.value, { dryRun, partial: partial.value });
		result.value = r;
		if (r.imported) { toast.success(t('import.done', { created: r.created, updated: r.updated })); emit('done'); }
	} catch (e) { toast.error(e.message); } finally { busy.value = false; }
}
</script>

<template>
	<Modal :title="t('import.title')" wide @close="emit('close')">
		<p class="text-muted small">{{ t('import.hint') }}
			<a href="#" @click.prevent="download('/assets/import-template', { format: 'xlsx' }, 'assets-template.xlsx')">{{ t('assets.template') }} (.xlsx)</a> ·
			<a href="#" @click.prevent="download('/assets/import-template', { format: 'csv' }, 'assets-template.csv')">(.csv)</a>
		</p>
		<label class="form-label">{{ t('import.file') }}</label>
		<input type="file" accept=".csv,.xlsx" class="form-control mb-2" @change="file = $event.target.files[0]; result = null" />
		<div class="form-check mb-3"><input id="part" v-model="partial" type="checkbox" class="form-check-input" /><label for="part" class="form-check-label">{{ t('import.partial') }}</label></div>

		<div v-if="result">
			<div v-if="result.dryRun" class="alert alert-success py-2">{{ t('import.valid', { n: result.valid }) }}</div>
			<div v-if="result.errors?.length">
				<div class="fw-semibold mb-1 text-danger">{{ t('import.errors') }} ({{ result.errors.length }})</div>
				<div style="max-height: 220px; overflow: auto">
					<table class="table table-sm table-is"><tbody>
						<tr v-for="(e, i) in result.errors" :key="i"><td>{{ t('import.line') }} {{ e.line }}</td><td>{{ e.tag }}</td><td>{{ e.message }}</td></tr>
					</tbody></table>
				</div>
			</div>
			<div v-else-if="result.dryRun" class="text-muted small">{{ t('import.none') }}</div>
		</div>
		<template #footer>
			<button class="btn btn-light" @click="emit('close')">{{ t('common.close') }}</button>
			<button class="btn btn-outline-primary" :disabled="!file || busy" @click="run(true)">{{ t('import.check') }}</button>
			<button class="btn btn-primary" :disabled="!file || busy" @click="run(false)">{{ t('import.run') }}</button>
		</template>
	</Modal>
</template>
