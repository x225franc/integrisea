import { createRouter, createWebHistory } from 'vue-router';
import { auth } from '@/stores/auth';
import { api } from '@/api';
import { setLocale } from '@/i18n';

const routes = [
	{ path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true } },
	{ path: '/', name: 'dashboard', component: () => import('@/views/Dashboard.vue') },
	{ path: '/assets', name: 'assets', component: () => import('@/views/Assets.vue') },
	{ path: '/assets/:id(\\d+)', name: 'asset', component: () => import('@/views/AssetDetail.vue') },
	{ path: '/facilities', name: 'facilities', component: () => import('@/views/Facilities.vue') },
	{ path: '/users', name: 'users', component: () => import('@/views/Users.vue'), meta: { admin: true } },
	{ path: '/config', name: 'config', component: () => import('@/views/Config.vue'), meta: { admin: true } },
	{ path: '/audit', name: 'audit', component: () => import('@/views/Audit.vue'), meta: { engineer: true } },
	{ path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
	if (to.meta.public) return auth.token && to.name === 'login' ? { name: 'dashboard' } : true;
	if (!auth.token) return { name: 'login' };
	if (!auth.user) {
		try {
			auth.user = (await api('/auth/me')).user;
			setLocale(auth.user.locale);
		} catch {
			auth.logout();
			return false;
		}
	}
	if (to.meta.admin && !auth.user.isAdmin) return { name: 'dashboard' };
	if (to.meta.engineer && !auth.canAny('engineer')) return { name: 'dashboard' };
	return true;
});

export default router;
