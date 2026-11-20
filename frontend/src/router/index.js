import { createRouter, createWebHistory } from 'vue-router';
import { auth } from '@/stores/auth';
import { api, hasSession } from '@/api';
import { setLocale } from '@/i18n';

const routes = [
	{ path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true } },
	{ path: '/', name: 'dashboard', component: () => import('@/views/Dashboard.vue') },
	{ path: '/assets', name: 'assets', component: () => import('@/views/Assets.vue') },
	{ path: '/assets/:id(\\d+)', name: 'asset', component: () => import('@/views/AssetDetail.vue') },
	{ path: '/rbi', name: 'rbi', component: () => import('@/views/Rbi.vue') },
	{ path: '/criticality', name: 'criticality', component: () => import('@/views/Criticality.vue') },
	{ path: '/inspections', name: 'inspections', component: () => import('@/views/Inspections.vue') },
	{ path: '/anomalies', name: 'anomalies', component: () => import('@/views/Anomalies.vue') },
	{ path: '/maintenance', name: 'maintenance', component: () => import('@/views/Maintenance.vue') },
	{ path: '/materials', name: 'materials', component: () => import('@/views/Materials.vue') },
	{ path: '/documents', name: 'documents', component: () => import('@/views/Documents.vue') },
	{ path: '/facilities', name: 'facilities', component: () => import('@/views/Facilities.vue') },
	{ path: '/users', name: 'users', component: () => import('@/views/Users.vue'), meta: { admin: true } },
	{ path: '/config', name: 'config', component: () => import('@/views/Config.vue'), meta: { admin: true } },
	{ path: '/audit', name: 'audit', component: () => import('@/views/Audit.vue'), meta: { engineer: true } },
	{ path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
	// Au premier chargement, on tente de restaurer la session depuis les cookies (rafraîchissement automatique si le jeton d'accès a expiré).
	if (!auth.restored) {
		if (hasSession()) {
			try { const r = await api('/auth/me'); auth.setSession(r.user); setLocale(r.user.locale); } catch { auth.restored = true; }
		} else auth.restored = true; // pas de cookie de session : inutile d'interroger le serveur
	}
	if (to.meta.public) return auth.user && to.name === 'login' ? { name: 'dashboard' } : true;
	if (!auth.user) return { name: 'login' };
	if (to.meta.admin && !auth.user.isAdmin) return { name: 'dashboard' };
	if (to.meta.engineer && !auth.canAny('engineer')) return { name: 'dashboard' };
	return true;
});

export default router;
