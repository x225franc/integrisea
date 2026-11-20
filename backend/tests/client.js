// Client HTTP des tests de bout en bout : se comporte comme un navigateur (conserve les cookies httpOnly, renvoie le jeton CSRF).
// Une « session » est un pot de cookies ; null = requête anonyme.
function createClient(base) {
	const newSession = () => ({ jar: new Map() });

	function absorb(sess, res) {
		for (const line of res.headers.getSetCookie?.() ?? []) {
			const [pair, ...attrs] = line.split(";");
			const i = pair.indexOf("=");
			const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
			const expired = attrs.some((a) => /^\s*(max-age=0|expires=)/i.test(a) && (/max-age=0/i.test(a) || new Date(a.split("=")[1]).getTime() < Date.now()));
			if (expired || value === "") sess.jar.delete(name); else sess.jar.set(name, { value, attrs: attrs.map((a) => a.trim().toLowerCase()) });
		}
	}

	/** call(méthode, chemin, session, corps JSON, corps brut) → { s: statut, j: JSON|Buffer, ct, h: en-têtes } */
	async function call(method, path, sess, body, raw, extra = {}) {
		const headers = { ...extra };
		if (sess?.jar.size) headers.Cookie = [...sess.jar].map(([k, v]) => `${k}=${v.value}`).join("; ");
		if (sess && !["GET", "HEAD", "OPTIONS"].includes(method) && sess.jar.has("integrisea_csrf") && !("X-CSRF-Token" in headers)) headers["X-CSRF-Token"] = sess.jar.get("integrisea_csrf").value;
		if (body && !raw) headers["Content-Type"] = "application/json";
		const res = await fetch(base + path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
		if (sess) absorb(sess, res);
		const ct = res.headers.get("content-type") || "";
		const j = ct.includes("json") ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
		return { s: res.status, j, ct, h: res.headers };
	}

	/** Ouvre une session : retourne le pot de cookies (ou null si la connexion échoue). */
	async function login(email, password) {
		const sess = newSession();
		const r = await call("POST", "/auth/login", sess, { email, password });
		return r.s === 200 ? sess : null;
	}

	return { call, login, newSession };
}

module.exports = { createClient };
