// Test de la pile de production (docker compose --profile app) : API + nginx + MySQL + S3, base vierge.
// Usage : PROD_URL=http://localhost:8180 node backend/tests/prod.smoke.js   (lit les identifiants dans .env.production)
const fs = require("fs");
const path = require("path");
const base = (process.env.PROD_URL || "http://localhost:8180") + "/api";
const envFile = fs.readFileSync(path.resolve(__dirname, "../../.env.production"), "utf8");
const env = Object.fromEntries(envFile.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
const { createClient } = require("./client");
const { call, newSession } = createClient(base);
let ok = 0, ko = 0;
const t = (n, c, x = "") => { c ? ok++ : ko++; console.log(c ? "✔" : "✖", n, c ? "" : x); };

(async () => {
	let r = await call("GET", "/health"); t("santé de l'API (base de données jointe)", r.j.ok === true);
	r = await call("GET", "/config"); t("config publique : production, pas de secret", r.j.env === "production" && !JSON.stringify(r.j).match(/secret|password|jwt/i));
	t("en-tête Cache-Control: no-store sur l'API", r.h.get("cache-control") === "no-store");
	r = await call("POST", "/auth/login", null, { email: env.SEED_ADMIN_EMAIL, password: "mauvais-mot-de-passe" }); t("mauvais mot de passe refusé", r.s === 401);
	const A = newSession();
	r = await call("POST", "/auth/login", A, { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }); t("connexion administrateur (cookies, aucun jeton dans la réponse)", r.s === 200 && r.j.user && !("token" in r.j), JSON.stringify(r.j));
	r = await call("GET", "/assets", A); t("base vierge en production : aucun jeu de démonstration", r.j.total === 0, String(r.j.total));
	r = await call("GET", "/settings", A); t("table des contraintes admissibles vide par défaut", Object.keys(r.j.allowableStress).length === 0);
	r = await call("POST", "/facilities", A, { code: "TST", name: "Installation test" }); t("création d'une installation", r.s === 201);
	const fac = r.j.id;
	r = await call("POST", "/systems", A, { facilityId: fac, code: "TST-S1", name: "Système test" }); t("création d'un système", r.s === 201);
	const sys = r.j.id;
	r = await call("POST", "/assets", A, { tag: "T-PIPE-1", systemId: sys, classCode: "PIPE", description: "Ligne test", fluid: "Crude oil", material: "CS", designPressureBarg: 40, designTempC: 80, odMm: 168.3, nominalThicknessMm: 7.11, installYear: 2015 });
	t("création d'un actif (classes initialisées par le seed)", r.s === 201, JSON.stringify(r.j));
	const asset = r.j.id;
	r = await call("POST", "/inspections", A, { assetId: asset, templateId: "UT", performedOn: "2026-10-01", readings: [{ cml: "C1", t: 6.5 }] });
	t("inspection UT enregistrée (gabarits initialisés)", r.s === 201, JSON.stringify(r.j));
	r = await call("GET", "/rbi/assets/" + asset, A);
	t("sans contrainte admissible : actif signalé non calculable, aucune valeur inventée", r.j.evaluation.calculable === false && r.j.evaluation.incomplete.some((x) => x.startsWith("allowableStress")) && r.j.evaluation.tmin === null, JSON.stringify(r.j.evaluation.incomplete));
	await call("PUT", "/settings/allowableStress", A, { value: { CS: { points: [{ tempC: -29, s: 138 }, { tempC: 200, s: 138 }] } } });
	r = await call("GET", "/rbi/assets/" + asset, A);
	t("après saisie de la contrainte : calculable, t_min 2,8 mm", r.j.evaluation.calculable === true && r.j.evaluation.tmin === 2.8, JSON.stringify(r.j.evaluation.tmin));
	await new Promise((x) => setTimeout(x, 2500));
	r = await call("GET", "/documents?q=IR-", A);
	t("rapport d'inspection stocké dans S3 et enregistré au registre", r.j.items.length === 1 && r.j.items[0].fileId, JSON.stringify(r.j));
	const fileId = r.j.items[0].fileId;
	r = await call("GET", "/files/" + fileId, A);
	t("téléchargement du rapport depuis S3 (PDF valide)", r.s === 200 && r.j.slice(0, 5).toString() === "%PDF-", String(r.s));
	t("en-têtes de sécurité sur le fichier téléchargé", r.h.get("x-content-type-options") === "nosniff" && /sandbox/.test(r.h.get("content-security-policy") || ""));
	r = await call("GET", "/audit", A); t("piste d'audit alimentée", r.j.total >= 5, String(r.j.total));
	r = await call("GET", "/export/maximo/pm?format=csv", A); t("export Maximo", r.s === 200);
	console.log(`\n${ok} OK, ${ko} KO`);
	process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
