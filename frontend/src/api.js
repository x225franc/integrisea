import { auth } from '@/stores/auth';

const BASE = `${__API_BASE__}/api`;

export class ApiError extends Error {
	constructor(status, message, details) {
		super(message);
		this.status = status;
		this.details = details;
	}
}

/** Jeton CSRF : cookie lisible posé par le serveur, renvoyé dans l'en-tête des requêtes qui modifient des données. */
const csrfToken = () => document.cookie.split('; ').find((c) => c.startsWith('integrisea_csrf='))?.split('=')[1] ?? '';

/** Une session existe-t-elle peut-être ? Le cookie CSRF (lisible, même durée que le rafraîchissement) sert d'indice : évite des appels voués au 401. */
export const hasSession = () => csrfToken() !== '';

// Un seul rafraîchissement à la fois (plusieurs requêtes qui expirent ensemble partagent la même rotation).
let refreshing = null;
function refreshSession() {
	refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken() } })
		.then((r) => r.ok).catch(() => false).finally(() => { refreshing = null; });
	return refreshing;
}

async function request(path, { method = 'GET', body, form, query } = {}, canRetry = true) {
	const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString() : '';
	const headers = {};
	if (body) headers['Content-Type'] = 'application/json';
	if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
	const res = await fetch(BASE + path + qs, { method, headers, credentials: 'include', body: form ?? (body ? JSON.stringify(body) : undefined) });
	// Jeton d'accès expiré (15 min) : une rotation du jeton de rafraîchissement, puis on rejoue la requête une fois.
	if (res.status === 401 && canRetry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
		if (hasSession() && await refreshSession()) return request(path, { method, body, form, query }, false);
		if (auth.user) auth.logout(true);
	}
	return res;
}

export async function api(path, opts) {
	const res = await request(path, opts);
	if (res.status === 204) return null;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError(res.status, data.message || res.statusText, data.details ?? data.errors);
	return data;
}

/** Import : renvoie aussi les réponses 422 (erreurs de validation) au lieu de lever. */
export async function apiImport(file, { dryRun, partial }, path = '/assets/import') {
	const form = new FormData();
	form.append('file', file);
	const res = await request(path, { method: 'POST', form, query: { dryRun: dryRun ? 1 : '', partial: partial ? 1 : '' } });
	const data = await res.json().catch(() => ({}));
	if (!res.ok && res.status !== 422) throw new ApiError(res.status, data.message || res.statusText);
	return data;
}

/** Télécharge un fichier (export, modèle) avec la session en cours. */
export async function download(path, query, filename) {
	const res = await request(path, { query });
	if (!res.ok) throw new ApiError(res.status, 'Téléchargement impossible');
	const url = URL.createObjectURL(await res.blob());
	const a = Object.assign(document.createElement('a'), { href: url, download: filename });
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
