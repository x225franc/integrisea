<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { setLocale } from '@/i18n';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
	busy.value = true; error.value = '';
	try {
		const r = await api('/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
		auth.setSession(r.token, r.user);
		setLocale(r.user.locale);
		router.replace({ name: 'dashboard' });
	} catch (e) {
		error.value = e.status === 429 ? e.message : t('login.failed');
	} finally { busy.value = false; }
}
</script>

<template>
	<div class="login-wrap">
		<form class="login-card" @submit.prevent="submit">
			<h1 class="h4 mb-0" style="color: var(--is-navy)">IntegriSea</h1>
			<p class="text-muted small mb-4">{{ t('app.tagline') }}</p>
			<div v-if="route.query.expired" class="alert alert-warning py-2">{{ t('login.expired') }}</div>
			<div v-if="error" class="alert alert-danger py-2">{{ error }}</div>
			<label class="form-label">{{ t('login.email') }}</label>
			<input v-model="email" type="email" class="form-control mb-3" autocomplete="username" required autofocus />
			<label class="form-label">{{ t('login.password') }}</label>
			<input v-model="password" type="password" class="form-control mb-4" autocomplete="current-password" required />
			<button class="btn btn-primary w-100" :disabled="busy">{{ t('login.submit') }}</button>
			<div class="text-center mt-3">
				<a href="#" class="small me-2" @click.prevent="setLocale('fr')" :class="{ 'fw-bold': locale === 'fr' }">FR</a>
				<a href="#" class="small" @click.prevent="setLocale('en')" :class="{ 'fw-bold': locale === 'en' }">EN</a>
			</div>
		</form>
	</div>
</template>
