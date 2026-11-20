// Tests de sécurité de bout en bout (cookies httpOnly, CSRF, rotation des jetons, verrouillage) et des nouvelles routes de configuration.
// Usage : node backend/tests/security.smoke.js — API démarrée + base de démonstration (npm run db:reset). Crée puis supprime un compte « sec.test ».
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const base = process.env.E2E_API || "http://127.0.0.1:4000/api";
const envFile = fs.readFileSync(path.resolve(__dirname, "../../.env.development"), "utf8");
const env = Object.fromEntries(envFile.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
const { createClient } = require("./client");
const { call, login, newSession } = createClient(base);

let ok = 0, ko = 0;
const t = (name, cond, extra = "") => { cond ? ok++ : ko++; console.log(cond ? "✔" : "✖", name, cond ? "" : extra); };
const cookieLine = (res, name) => (res.h.getSetCookie?.() ?? []).find((l) => l.startsWith(name + "="));

(async () => {
	require("../config/env");
	const db = require("../config/db");
	const TEST = "sec.test@integrisea.local", PWD = "Secur1te-Test-2026!";
	await db.query("DELETE FROM users WHERE email = ?", [TEST]);
	await db.query("INSERT INTO users (email,password_hash,full_name,is_admin) VALUES (?,?,?,0)", [TEST, await bcrypt.hash(PWD, 4), "Test sécurité"]);
	const [[{ id: uid }]] = await db.query("SELECT id FROM users WHERE email = ?", [TEST]);

	// --- Cookies de session ---
	const S = newSession();
	let r = await call("POST", "/auth/login", S, { email: TEST, password: PWD });
	t("connexion : 200 et aucun jeton dans le corps de la réponse", r.s === 200 && r.j.user && !("token" in r.j) && !JSON.stringify(r.j).includes("eyJ"), JSON.stringify(r.j));
	const at = cookieLine(r, "integrisea_at"), rt = cookieLine(r, "integrisea_rt"), cs = cookieLine(r, "integrisea_csrf");
	t("jeton d'accès : cookie httpOnly, SameSite=Strict, 15 minutes", at && /HttpOnly/i.test(at) && /SameSite=Strict/i.test(at) && /Max-Age=900/i.test(at), at);
	t("jeton de rafraîchissement : cookie httpOnly, SameSite=Strict, limité à /api/auth", rt && /HttpOnly/i.test(rt) && /SameSite=Strict/i.test(rt) && /Path=\/api\/auth/i.test(rt), rt);
	t("jeton CSRF : lisible par la page (pas httpOnly), SameSite=Strict", cs && !/HttpOnly/i.test(cs) && /SameSite=Strict/i.test(cs), cs);
	t("HTTP simple : cookies sans attribut Secure (le navigateur les refuserait, la connexion échouerait)", !/;\s*Secure/i.test(at) && !/;\s*Secure/i.test(rt) && !/;\s*Secure/i.test(cs));
	const viaTls = await call("POST", "/auth/login", null, { email: TEST, password: PWD }, null, { "X-Forwarded-Proto": "https" });
	t("derrière un proxy TLS (X-Forwarded-Proto: https) : les trois cookies sont Secure", ["integrisea_at", "integrisea_rt", "integrisea_csrf"].every((n) => /;\s*Secure/i.test(cookieLine(viaTls, n) || "")), cookieLine(viaTls, "integrisea_at"));
	r = await call("GET", "/auth/me", S); t("session : /auth/me avec les cookies", r.s === 200 && r.j.user.email === TEST);
	r = await call("GET", "/auth/me", null); t("sans cookie : 401", r.s === 401);
	r = await call("GET", "/auth/me", null, null, null, { Authorization: "Bearer abc" }); t("l'en-tête Authorization n'est plus accepté", r.s === 401);

	// --- CSRF ---
	r = await call("PUT", "/auth/me", S, { locale: "en" }, null, { "X-CSRF-Token": "faux" });
	t("CSRF : requête qui modifie avec un jeton faux → 403", r.s === 403, String(r.s));
	const noCsrf = newSession(); for (const [k, v] of S.jar) if (k !== "integrisea_csrf") noCsrf.jar.set(k, v);
	r = await call("PUT", "/auth/me", noCsrf, { locale: "en" });
	t("CSRF : requête qui modifie sans jeton → 403", r.s === 403, String(r.s));
	r = await call("PUT", "/auth/me", S, { locale: "fr" }); t("CSRF : requête avec le bon jeton → 200", r.s === 200);
	r = await call("GET", "/assets?limit=1", S); t("lecture (GET) sans exigence CSRF", r.s === 200 || r.s === 403);

	// --- Rafraîchissement avec rotation ---
	const oldRt = S.jar.get("integrisea_rt").value;
	r = await call("POST", "/auth/refresh", S);
	t("rafraîchissement : 200, nouveau cookie de rafraîchissement", r.s === 200 && S.jar.get("integrisea_rt").value !== oldRt, String(r.s) + JSON.stringify(r.j));
	r = await call("GET", "/auth/me", S); t("session toujours valide après rotation", r.s === 200);
	// Rejeu de l'ancien jeton après le délai de grâce (10 s) : toute la famille est révoquée.
	await db.query("UPDATE refresh_tokens SET revoked_at = DATE_SUB(NOW(), INTERVAL 60 SECOND) WHERE user_id = ? AND revoked_at IS NOT NULL", [uid]);
	const thief = newSession(); thief.jar.set("integrisea_rt", { value: oldRt }); thief.jar.set("integrisea_csrf", S.jar.get("integrisea_csrf"));
	r = await call("POST", "/auth/refresh", thief); t("jeton déjà utilisé rejoué → 401", r.s === 401, String(r.s));
	r = await call("POST", "/auth/refresh", S); t("rejeu détecté : la session légitime est révoquée aussi", r.s === 401, String(r.s));
	r = await call("GET", "/auth/me", S); t("… et son jeton d'accès cesse de fonctionner immédiatement", r.s === 401, String(r.s));
	const [reuse] = await db.query("SELECT id FROM audit_log WHERE action = 'refresh_reuse' AND user_id = ?", [uid]);
	t("rejeu inscrit dans la piste d'audit", reuse.length >= 1);

	// --- Rafraîchissement : CSRF et jeton invalide ---
	const S2 = await login(TEST, PWD);
	const bad = newSession(); bad.jar.set("integrisea_rt", S2.jar.get("integrisea_rt"));
	r = await call("POST", "/auth/refresh", bad); t("rafraîchissement sans jeton CSRF → 403 (le jeton n'est pas consommé)", r.s === 403, String(r.s));
	r = await call("POST", "/auth/refresh", S2); t("… et la session reste rafraîchissable ensuite", r.s === 200, String(r.s));
	const junk = newSession(); junk.jar.set("integrisea_rt", { value: "n-importe-quoi" });
	r = await call("POST", "/auth/refresh", junk); t("jeton de rafraîchissement inconnu → 401", r.s === 401);

	// --- Déconnexion ---
	const keep = new Map(S2.jar); // copie des cookies d'avant la déconnexion (le navigateur, lui, les efface)
	r = await call("POST", "/auth/logout", S2); t("déconnexion : 200", r.s === 200);
	r = await call("POST", "/auth/refresh", S2); t("après déconnexion : le jeton de rafraîchissement est révoqué", r.s === 401, String(r.s));
	const stale = newSession(); stale.jar = keep;
	r = await call("GET", "/auth/me", stale); t("après déconnexion : le jeton d'accès cesse de fonctionner immédiatement", r.s === 401, String(r.s));
	const [lo] = await db.query("SELECT id FROM audit_log WHERE action = 'logout' AND user_id = ?", [uid]);
	t("déconnexion inscrite dans la piste d'audit", lo.length >= 1);

	// --- Changement de mot de passe : révoque les autres sessions ---
	const S3 = await login(TEST, PWD), S4 = await login(TEST, PWD);
	r = await call("POST", "/auth/change-password", S3, { currentPassword: PWD, newPassword: "Nouveau-Mot-De-Passe-2026!" });
	t("changement de mot de passe : 200 et nouvelle session", r.s === 200, JSON.stringify(r.j));
	r = await call("GET", "/auth/me", S3); t("la session qui change le mot de passe reste active", r.s === 200);
	r = await call("GET", "/auth/me", S4); t("les autres sessions sont coupées", r.s === 401, String(r.s));
	r = await call("POST", "/auth/refresh", S4); t("… y compris leur jeton de rafraîchissement", r.s === 401);
	const PWD2 = "Nouveau-Mot-De-Passe-2026!";

	// --- Verrouillage de compte : 5 échecs → 15 minutes ---
	let last;
	for (let i = 1; i <= 4; i++) { last = await call("POST", "/auth/login", null, { email: TEST, password: "mauvais" + i }); }
	t("4 échecs : toujours 401 (pas encore verrouillé)", last.s === 401);
	last = await call("POST", "/auth/login", null, { email: TEST, password: "mauvais5" });
	t("5e échec : 401 et le compte est verrouillé", last.s === 401);
	r = await call("POST", "/auth/login", null, { email: TEST, password: PWD2 });
	t("compte verrouillé : même le bon mot de passe est refusé (423)", r.s === 423 && /verrouill/i.test(r.j.message), `${r.s} ${r.j.message}`);
	const [[u]] = await db.query("SELECT locked_until > NOW() AS locked, TIMESTAMPDIFF(MINUTE, NOW(), locked_until) AS m FROM users WHERE id = ?", [uid]);
	t("blocage d'environ 15 minutes", u.locked && u.m >= 14 && u.m <= 15, JSON.stringify(u));
	const [aud] = await db.query("SELECT action, COUNT(*) n FROM audit_log WHERE user_id = ? AND action IN ('login_failed','account_locked','login_blocked') GROUP BY action", [uid]);
	const cnt = Object.fromEntries(aud.map((a) => [a.action, a.n]));
	t("échecs, verrouillage et tentative bloquée inscrits dans la piste d'audit", cnt.login_failed === 4 && cnt.account_locked === 1 && cnt.login_blocked >= 1, JSON.stringify(cnt));
	const A = await login(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
	r = await call("GET", "/users", A); t("l'administrateur voit le compte verrouillé", r.s === 200 && !!r.j.find((x) => x.id === uid)?.lockedUntil);
	r = await call("POST", `/users/${uid}/unlock`, A); t("déverrouillage par l'administrateur", r.s === 200 && !r.j.lockedUntil);
	r = await call("POST", "/auth/login", null, { email: TEST, password: PWD2 }); t("connexion possible après déverrouillage", r.s === 200);
	// Expiration naturelle du verrou
	for (let i = 0; i < 5; i++) await call("POST", "/auth/login", null, { email: TEST, password: "x" + i });
	await db.query("UPDATE users SET locked_until = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [uid]);
	r = await call("POST", "/auth/login", null, { email: TEST, password: PWD2 }); t("verrou expiré : connexion à nouveau possible", r.s === 200);
	r = await call("POST", "/auth/login", null, { email: "inconnu@example.com", password: "x" }); t("email inconnu : même réponse 401 générique", r.s === 401 && r.j.message === "Email ou mot de passe incorrect");

	// --- Nouvelles routes de configuration ---
	// (idempotence : on retire d'abord toute validation laissée par une exécution précédente)
	await call("POST", "/settings/template:EXD/validate", A, { validated: false });
	await call("POST", "/settings/matrix/validate", A, { validated: false });
	r = await call("GET", "/settings", A);
	t("configuration : état de validation exposé (tout est provisoire au départ)", r.s === 200 && r.j._meta.provisional.includes("matrix") && r.j._meta.provisional.includes("template:EXD"), JSON.stringify(r.j._meta?.provisional?.slice(0, 3)));
	r = await call("POST", "/settings/matrix/validate", A, {}); t("l'administrateur valide la matrice", r.s === 200);
	r = await call("GET", "/settings", A); t("la matrice n'est plus provisoire", !r.j._meta.provisional.includes("matrix") && !!r.j._meta.validated.matrix);
	r = await call("PUT", "/settings/matrix", A, { value: r.j.matrix }); r = await call("GET", "/settings", A);
	t("toute modification redevient provisoire", r.j._meta.provisional.includes("matrix"));
	r = await call("POST", "/settings/template:EXD/validate", A, {}); t("validation d'un gabarit d'inspection", r.s === 200);
	r = await call("POST", "/settings/inconnue/validate", A, {}); t("clé inconnue → 404", r.s === 404);
	const eng = await login("ingenieur.aur@integrisea.local", env.SEED_ADMIN_PASSWORD);
	r = await call("POST", "/settings/matrix/validate", eng, {}); t("validation réservée à l'administrateur (403)", r.s === 403);

	// Import de la table des contraintes (matériau × température)
	const csv = "material;temp_c;s_mpa;family\nCS;-29;138;carbon\nCS;200;120,5;carbon\n316L;20;115;cra\n";
	const form = (name, content) => { const f = new FormData(); f.append("file", new Blob([content]), name); return f; };
	r = await call("POST", "/settings/allowable-stress/import?dryRun=1", A, null, form("t.csv", csv));
	t("import des contraintes : aperçu (rien d'enregistré)", r.s === 200 && r.j.dryRun && r.j.materials === 2 && r.j.points === 3, JSON.stringify(r.j));
	r = await call("POST", "/settings/allowable-stress/import", A, null, form("t.csv", "material;temp_c;s_mpa\nCS;-29;138\nCS;-29;139\n;20;100\n"));
	t("import des contraintes : erreurs par ligne (422)", r.s === 422 && r.j.errors.length === 2 && r.j.errors[0].line === 3, JSON.stringify(r.j));
	r = await call("POST", "/settings/allowable-stress/import", eng, null, form("t.csv", csv)); t("import réservé à l'administrateur", r.s === 403);
	const before = (await call("GET", "/settings", A)).j.allowableStress;
	r = await call("POST", "/settings/allowable-stress/import", A, null, form("t.csv", csv));
	t("import des contraintes appliqué", r.s === 200 && r.j.imported, JSON.stringify(r.j));
	r = await call("GET", "/settings", A);
	t("table remplacée (CS interpolable, plus de duplex) et marquée provisoire", r.j.allowableStress.CS.points.length === 2 && !r.j.allowableStress["22Cr Duplex"] && r.j._meta.provisional.includes("allowableStress"));
	r = await call("GET", "/settings/allowable-stress/export?format=csv", A); t("export de la table (modèle d'import)", r.s === 200 && /CS;-29;138/.test(r.j.toString()));
	const [imp] = await db.query("SELECT id FROM audit_log WHERE action = 'config_import'"); t("import inscrit dans la piste d'audit", imp.length >= 1);
	r = await call("PUT", "/settings/allowableStress", A, { value: before }); t("table de démonstration restaurée", r.s === 200);
	r = await call("PUT", "/settings/allowableStress", A, { value: { CS: { points: [{ tempC: 100, s: 130 }, { tempC: 20, s: 150 }] } } }); t("table invalide (températures non croissantes) refusée", r.s === 400);

	// --- Disciplines ---
	r = await call("GET", "/assets?limit=500", A);
	const by = (d) => r.j.items.filter((a) => a.discipline === d).length;
	t("disciplines par défaut : PV/HX/PSV/PIPE/SBT/HOSE/EX → Pressure Systems, STR → Structural, RISER → Pipelines",
		r.j.items.every((a) => (a.classCode === "STR" ? a.discipline === "Structural" : a.classCode === "RISER" ? a.discipline === "Pipelines" : a.discipline === "Pressure Systems")), `${by("Pressure Systems")}/${by("Structural")}/${by("Pipelines")}`);
	r = await call("GET", "/assets?discipline=Structural&limit=500", A); t("filtre par discipline : registre des actifs", r.j.items.length > 0 && r.j.items.every((a) => a.discipline === "Structural"));
	r = await call("GET", "/rbi/assets?discipline=Pipelines", A); t("filtre par discipline : liste RBI", r.j.items.length > 0 && r.j.items.every((a) => a.classCode === "RISER"));
	r = await call("GET", "/inspections/schedule?discipline=Structural", A); t("filtre par discipline : planning d'inspection", r.j.length > 0 && r.j.every((a) => a.classCode === "STR"));
	const allAn = await call("GET", "/anomalies?status=all", A);
	r = await call("GET", "/anomalies?status=all&discipline=Structural", A); t("filtre par discipline : anomalies", r.s === 200 && r.j.total > 0 && r.j.total < allAn.j.total, `${r.j.total}/${allAn.j.total}`);
	r = await call("GET", "/rbi/dashboard?discipline=Pipelines", A); t("filtre par discipline : tableau de bord", r.j.kpis.assets === 2, JSON.stringify(r.j.kpis));
	r = await call("GET", "/maintenance/fmea", A); t("bibliothèque AMDE : disciplines remplacées", r.j.length > 0 && r.j.every((x) => ["Pressure Systems", "Structural", "Pipelines"].includes(x.discipline)), [...new Set(r.j.map((x) => x.discipline))].join(","));
	const pipe = r.s === 200 && (await call("GET", "/assets?q=30-PL-3001", A)).j.items[0];
	r = await call("PUT", `/assets/${pipe.id}`, A, { discipline: "Inventée" }); t("discipline hors liste refusée (400)", r.s === 400);
	r = await call("PUT", `/assets/${pipe.id}`, A, { discipline: "Pipelines" }); t("discipline modifiable sur l'actif", r.s === 200 && r.j.discipline === "Pipelines");
	r = await call("PUT", `/assets/${pipe.id}`, A, { discipline: "" }); t("discipline vide = défaut de la classe", r.s === 200 && r.j.discipline === "Pressure Systems", JSON.stringify(r.j.discipline));
	r = await call("PUT", "/settings/disciplines", A, { value: ["Pressure Systems", "Structural", "Pipelines", "Marine"] }); t("liste des disciplines configurable", r.s === 200);
	r = await call("PUT", `/assets/${pipe.id}`, A, { discipline: "Marine" }); t("nouvelle discipline utilisable", r.s === 200 && r.j.discipline === "Marine");
	await call("PUT", `/assets/${pipe.id}`, A, { discipline: "" });
	await call("PUT", "/settings/disciplines", A, { value: ["Pressure Systems", "Structural", "Pipelines"] });

	// --- Moteur : détail du calcul par CML et valeurs provisoires ---
	r = await call("GET", `/rbi/assets/${pipe.id}`, A);
	const ev = r.j.evaluation;
	t("détail du calcul : une ligne et une série par CML, CML gouvernant désigné", ev.cmls?.length >= 2 && ev.governingCml && ev.lines.some((l) => l.code === "corrosion_cml" && l.params.governing), ev.governingCml);
	t("détail du calcul : périmètre et exclusions de t_min rappelés", ev.lines.some((l) => l.code === "tmin_scope"));
	r = await call("GET", "/maintenance/end-of-life", A); t("fin de vie toujours calculée", r.s === 200);

	await db.query("DELETE FROM users WHERE email = ?", [TEST]);
	await db.end();
	console.log(`\n${ok} OK, ${ko} KO`);
	process.exit(ko ? 1 : 0);
})().catch((e) => { console.error("✖", e); process.exit(1); });
