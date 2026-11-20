import { auth } from '@/stores/auth';

const BASE = `${__API_BASE__}/api`;

export class ApiError extends Error {
	constructor(status, message, details) {
		super(message);
		this.status = status;
		this.details = details;
	}
}

async function request(path, { method = 'GET', body, form, query } = {}) {
	const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString() : '';
	const headers = {};
	if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
	if (body) headers['Content-Type'] = 'application/json';
	const res = await fetch(BASE + path + qs, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
	if (res.status === 401 && auth.token && !path.startsWith('/auth/login')) auth.logout(true);
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
export async function apiImport(file, { dryRun, partial }) {
	const form = new FormData();
	form.append('file', file);
	const res = await request('/assets/import', { method: 'POST', form, query: { dryRun: dryRun ? 1 : '', partial: partial ? 1 : '' } });
	const data = await res.json().catch(() => ({}));
	if (!res.ok && res.status !== 422) throw new ApiError(res.status, data.message || res.statusText);
	return data;
}

/** Télécharge un fichier (export, modèle) avec le jeton d'authentification. */
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
