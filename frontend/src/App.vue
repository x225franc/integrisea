<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { auth } from '@/stores/auth';
import { lookups } from '@/stores/lookups';
import { api } from '@/api';
import { setLocale } from '@/i18n';
import Modal from '@/components/Modal.vue';

const route = useRoute();
const { t, locale } = useI18n();
const toast = useToast();
const showWarning = ref(true);
const pwdOpen = ref(false);
const pwd = ref({ currentPassword: '', newPassword: '' });

const isPublic = computed(() => route.meta.public);
const nav = computed(() => [
	{ to: '/', icon: 'fa-gauge-high', label: t('nav.dashboard'), show: true },
	{ to: '/assets', icon: 'fa-list-ul', label: t('nav.assets'), show: true },
	{ to: '/rbi', icon: 'fa-table-cells', label: t('nav.rbi'), show: true },
	{ to: '/criticality', icon: 'fa-shield-halved', label: t('nav.criticality'), show: true },
	{ to: '/inspections', icon: 'fa-clipboard-check', label: t('nav.inspections'), show: true },
	{ to: '/anomalies', icon: 'fa-triangle-exclamation', label: t('nav.anomalies'), show: true },
	{ to: '/maintenance', icon: 'fa-screwdriver-wrench', label: t('nav.maintenance'), show: true },
	{ to: '/materials', icon: 'fa-boxes-stacked', label: t('nav.materials'), show: true },
	{ to: '/documents', icon: 'fa-folder-open', label: t('nav.documents'), show: true },
	{ to: '/facilities', icon: 'fa-sitemap', label: t('nav.facilities'), show: true },
	{ to: '/audit', icon: 'fa-clock-rotate-left', label: t('nav.audit'), show: auth.canAny('engineer') },
	{ to: '/users', icon: 'fa-users', label: t('nav.users'), show: auth.user?.isAdmin },
	{ to: '/config', icon: 'fa-gear', label: t('nav.config'), show: auth.user?.isAdmin },
].filter((n) => n.show));

onMounted(async () => {
	try { showWarning.value = (await api('/config')).showValidationWarning; } catch { /* bandeau affiché par défaut */ }
});
watch(() => auth.user, (u) => { if (u) lookups.load().catch(() => {}); else lookups.reset(); }, { immediate: true });

async function switchLocale(l) {
	setLocale(l);
	if (auth.user) api('/auth/me', { method: 'PUT', body: { locale: l } }).catch(() => {});
}
async function changePassword() {
	try {
		await api('/auth/change-password', { method: 'POST', body: pwd.value }); // une nouvelle session est ouverte par cookies
		pwdOpen.value = false;
		pwd.value = { currentPassword: '', newPassword: '' };
		toast.success(t('common.saved'));
	} catch (e) { toast.error(e.details?.[0]?.message || e.message); }
}
</script>

<template>
	<router-view v-if="isPublic" />
	<div v-else-if="auth.user" class="layout">
		<aside class="sidebar">
			<div class="brand">IntegriSea<small>{{ t('app.tagline') }}</small></div>
			<router-link v-for="n in nav" :key="n.to" :to="n.to" class="nav-item" :exact-active-class="n.to === '/' ? 'router-link-active' : ''" :active-class="n.to === '/' ? '' : 'router-link-active'">
				<i class="fa-solid" :class="n.icon"></i><span>{{ n.label }}</span>
			</router-link>
		</aside>
		<div class="main">
			<div v-if="showWarning" class="warn-banner"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ t('warning') }}</div>
			<div class="topbar">
				<select v-model="auth.facility" class="form-select form-select-sm" style="max-width: 240px" :aria-label="t('assets.facility')">
					<option value="">{{ t('nav.allFacilities') }}</option>
					<option v-for="f in lookups.facilities" :key="f.id" :value="f.id">{{ f.name }}</option>
				</select>
				<div class="ms-auto d-flex align-items-center gap-2">
					<div class="btn-group btn-group-sm">
						<button class="btn btn-outline-secondary" :class="{ active: locale === 'fr' }" @click="switchLocale('fr')">FR</button>
						<button class="btn btn-outline-secondary" :class="{ active: locale === 'en' }" @click="switchLocale('en')">EN</button>
					</div>
					<span class="text-muted small d-none d-md-inline">{{ auth.user.fullName }}</span>
					<button class="btn btn-sm btn-outline-secondary" :title="t('nav.password')" @click="pwdOpen = true"><i class="fa-solid fa-key"></i></button>
					<button class="btn btn-sm btn-outline-secondary" :title="t('nav.logout')" @click="auth.logout()"><i class="fa-solid fa-right-from-bracket"></i></button>
				</div>
			</div>
			<main class="content"><router-view :key="route.fullPath" /></main>
		</div>

		<Modal v-if="pwdOpen" :title="t('password.title')" @close="pwdOpen = false">
			<form @submit.prevent="changePassword" id="pwdform">
				<label class="form-label">{{ t('password.current') }}</label>
				<input v-model="pwd.currentPassword" type="password" class="form-control mb-3" autocomplete="current-password" required />
				<label class="form-label">{{ t('password.new') }}</label>
				<input v-model="pwd.newPassword" type="password" class="form-control" autocomplete="new-password" minlength="10" required />
			</form>
			<template #footer>
				<button class="btn btn-light" @click="pwdOpen = false">{{ t('common.cancel') }}</button>
				<button class="btn btn-primary" form="pwdform" type="submit">{{ t('common.save') }}</button>
			</template>
		</Modal>
	</div>
</template>
