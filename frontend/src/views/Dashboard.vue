<script setup>
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';

const { t, locale } = useI18n();
const total = ref(0);
const byClass = ref([]);

async function load() {
	await lookups.load();
	const base = { facility: auth.facility, limit: 1 };
	total.value = (await api('/assets', { query: base })).total;
	byClass.value = (await Promise.all(lookups.classes.filter((c) => c.isActive).map(async (c) => ({
		code: c.code, n: (await api('/assets', { query: { ...base, class: c.code } })).total,
	})))).filter((c) => c.n > 0);
}
watch(() => auth.facility, load, { immediate: true });

const facilitiesCount = computed(() => (auth.facility ? 1 : lookups.facilities.length));
const systemsCount = computed(() => lookups.systems.filter((s) => !auth.facility || s.facilityId === Number(auth.facility)).length);
</script>

<template>
	<h1 class="h4 mb-3">{{ t('dashboard.welcome') }}, {{ auth.user.fullName }}</h1>
	<div class="row g-3 mb-3">
		<div class="col-6 col-md-4"><div class="card-is kpi"><div class="text-muted small">{{ t('dashboard.assets') }}</div><div class="v">{{ total }}</div></div></div>
		<div class="col-6 col-md-4"><div class="card-is kpi"><div class="text-muted small">{{ t('dashboard.facilities') }}</div><div class="v">{{ facilitiesCount }}</div></div></div>
		<div class="col-6 col-md-4"><div class="card-is kpi"><div class="text-muted small">{{ t('dashboard.systems') }}</div><div class="v">{{ systemsCount }}</div></div></div>
	</div>
	<div class="card-is p-3 mb-3">
		<h2 class="h6">{{ t('dashboard.byClass') }}</h2>
		<div class="d-flex flex-wrap gap-2">
			<span v-for="c in byClass" :key="c.code" class="badge badge-class fs-6 fw-normal">{{ lookups.className(c.code, locale) }} <strong>{{ c.n }}</strong></span>
		</div>
	</div>
	<p class="text-muted">{{ t('dashboard.next') }}</p>
</template>
