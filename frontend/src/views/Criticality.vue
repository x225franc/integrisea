<script setup>
import { ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { settings } from '@/stores/settings';
import ExportMenu from '@/components/ExportMenu.vue';

const { t, locale } = useI18n();
const rows = ref([]);
const cfg = ref(null);

async function load() { rows.value = await api('/rbi/criticality', { query: { facility: auth.facility } }); }
watch(() => auth.facility, load, { immediate: true });
onMounted(async () => { cfg.value = await settings.load(); });
</script>

<template>
	<div class="d-flex align-items-center mb-3 gap-2">
		<h1 class="h4 mb-0 me-auto">{{ t('crit.title') }}</h1>
		<ExportMenu path="/rbi/criticality" :query="{ facility: auth.facility }" name="criticite" />
	</div>
	<p class="text-muted small">{{ t('crit.rule') }}</p>

	<div class="card-is mb-4">
		<h2 class="h6 p-3 pb-0">{{ t('crit.systems') }}</h2>
		<div class="table-responsive">
			<table class="table table-sm table-is mb-0">
				<thead><tr><th>{{ t('facilities.code') }}</th><th>{{ t('facilities.name') }}</th><th>{{ t('crit.assets') }}</th><th class="text-center">A</th><th class="text-center">B</th><th class="text-center">C</th><th class="text-center">SCE</th><th class="text-center">CoF max</th></tr></thead>
				<tbody>
					<tr v-for="s in rows" :key="s.systemId">
						<td class="fw-semibold">{{ s.code }}</td><td>{{ s.name }}</td><td>{{ s.assets }}</td>
						<td class="text-center"><span class="badge" :class="s.a ? 'text-bg-danger' : 'text-bg-light'">{{ s.a }}</span></td>
						<td class="text-center"><span class="badge" :class="s.b ? 'text-bg-warning' : 'text-bg-light'">{{ s.b }}</span></td>
						<td class="text-center"><span class="badge text-bg-light">{{ s.c }}</span></td>
						<td class="text-center">{{ s.sce }}</td><td class="text-center">{{ s.maxCof }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<div v-if="cfg" class="row g-3">
		<div class="col-lg-7">
			<div class="card-is p-3">
				<h2 class="h6">{{ t('crit.scales') }}</h2>
				<table class="table table-sm table-is mb-0">
					<thead><tr><th>#</th><th>{{ t('crit.scoreS') }}</th><th>{{ t('crit.scoreE') }}</th><th>{{ t('crit.scoreP') }}</th></tr></thead>
					<tbody><tr v-for="i in 5" :key="i"><td class="fw-bold">{{ i }}</td><td v-for="a in ['s', 'e', 'p']" :key="a" class="small">{{ cfg.consequenceScales[a][locale][i - 1] }}</td></tr></tbody>
				</table>
			</div>
		</div>
		<div class="col-lg-5">
			<div class="card-is p-3">
				<h2 class="h6">{{ t('crit.rules') }}</h2>
				<table class="table table-sm table-is mb-0">
					<thead><tr><th>{{ t('cfg.fluid') }}</th><th>S</th><th>E</th><th>P</th></tr></thead>
					<tbody><tr v-for="(v, f) in cfg.fluidCriticality" :key="f"><td>{{ f }}</td><td>{{ v[0] }}</td><td>{{ v[1] }}</td><td>{{ v[2] }}</td></tr></tbody>
				</table>
			</div>
		</div>
	</div>
</template>
