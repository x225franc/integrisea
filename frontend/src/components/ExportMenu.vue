<script setup>
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { download } from '@/api';

// Bouton d'export CSV / Excel d'une liste : path = route API, query = filtres courants.
const props = defineProps({ path: { type: String, required: true }, query: { type: Object, default: () => ({}) }, name: { type: String, default: 'export' } });
const { t } = useI18n();
const toast = useToast();
async function go(format) {
	try { await download(props.path, { ...props.query, format }, `${props.name}.${format}`); } catch (e) { toast.error(e.message); }
}
</script>

<template>
	<div class="dropdown d-inline-block">
		<button class="btn btn-outline-secondary btn-sm dropdown-toggle" data-bs-toggle="dropdown"><i class="fa-solid fa-download me-1"></i>{{ t('common.export') }}</button>
		<ul class="dropdown-menu">
			<li><a class="dropdown-item" href="#" @click.prevent="go('xlsx')">Excel (.xlsx)</a></li>
			<li><a class="dropdown-item" href="#" @click.prevent="go('csv')">CSV</a></li>
		</ul>
	</div>
</template>
