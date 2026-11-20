// Test de bout en bout contre une API démarrée (npm run dev) et une base peuplée (npm run db:reset).
// Usage : node backend/tests/e2e.smoke.js   — non lancé par `npm test` (nécessite MySQL et les données de démonstration).
const fs = require("fs");
const path = require("path");
const base = process.env.E2E_API || "http://localhost:4000/api";
const envFile = fs.readFileSync(path.resolve(__dirname, "../../.env.development"), "utf8");
const env = Object.fromEntries(envFile.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));

const call = async (m, p, tok, body, raw) => {
	const r = await fetch(base + p, { method: m, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(body && !raw ? { "Content-Type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
	const ct = r.headers.get("content-type") || "";
	const j = ct.includes("json") ? await r.json().catch(() => ({})) : Buffer.from(await r.arrayBuffer());
	return { s: r.status, j, ct };
};
let ok = 0, ko = 0;
const t = (name, cond, extra = "") => { cond ? ok++ : ko++; console.log(cond ? "✔" : "✖", name, cond ? "" : extra); };

(async () => {
	const login = async (e) => (await call("POST", "/auth/login", null, { email: e, password: env.SEED_ADMIN_PASSWORD })).j.token;
	const A = await login(env.SEED_ADMIN_EMAIL), ENG = await login("ingenieur.aur@integrisea.local"), INS = await login("inspecteur@integrisea.local"), RD = await login("lecteur.wha@integrisea.local");

	let r = await call("GET", "/rbi/dashboard", A);
	t("tableau de bord : KPIs", r.s === 200 && r.j.kpis.assets === 41, JSON.stringify(r.j.kpis));
	console.log("   KPIs", JSON.stringify(r.j.kpis), "| anomalies", JSON.stringify(r.j.anomaliesByPriority));
	const rd = await call("GET", "/rbi/dashboard", RD);
	t("lecteur WHA : tableau de bord limité à son installation", rd.j.kpis.assets > 0 && rd.j.kpis.assets < 41, String(rd.j.kpis.assets));
	const cell = Object.keys(r.j.counts)[0].split("-");
	r = await call("GET", `/rbi/assets?pof=${cell[0]}&cof=${cell[1]}`, A);
	t("clic sur une case de la matrice : liste RBI filtrée", r.j.total === r.j.items.length && r.j.items.every((i) => i.pof == +cell[0] && i.cof == +cell[1]));
	const first = (await call("GET", "/rbi/assets?class=PIPE", A)).j.items[0];
	r = await call("GET", "/rbi/assets/" + first.assetId, A);
	t("détail du calcul ligne par ligne", r.j.evaluation.lines.length >= 5, JSON.stringify(r.j.evaluation.lines.map((l) => l.code)));

	// ACCEPTATION : une mesure UT sous t_min déclenche la proposition d'une anomalie P1 et le risque est recalculé
	const pipe = (await call("GET", "/assets?q=30-PL-3001", A)).j.items[0]; // duplex peu corrodé : PoF faible au départ
	const before = (await call("GET", "/rbi/assets/" + pipe.id, A)).j.evaluation;
	r = await call("POST", "/inspections", INS, { assetId: pipe.id, templateId: "UT", performedOn: "2026-11-10", readings: [{ cml: "CML-01", t: 15.0 }, { cml: "CML-02", t: 12.0 }], data: { coating: "Poor" } });
	t("inspecteur : saisie d'une mesure UT", r.s === 201, JSON.stringify(r.j));
	t("ACCEPTATION : mesure sous t_min → anomalie P1 proposée", r.j.suggestion?.priority === "P1", JSON.stringify(r.j.suggestion));
	t("ACCEPTATION : risque recalculé immédiatement (PoF 5)", r.j.evaluation.pof === 5 && before.pof < 5, `avant ${before.pof} après ${r.j.evaluation.pof}`);
	const inspId = r.j.id;
	r = await call("POST", "/inspections", RD, { assetId: pipe.id, templateId: "UT", performedOn: "2026-11-10", readings: [{ cml: "a", t: 5 }] });
	t("lecteur : saisie refusée (403)", r.s === 403, String(r.s));
	r = await call("POST", "/inspections", A, { assetId: pipe.id, templateId: "PSV", performedOn: "2026-11-10", data: {} });
	t("gabarit non applicable à la classe refusé (400)", r.s === 400, String(r.s));
	r = await call("GET", `/inspections/${inspId}/report`, A);
	t("rapport d'inspection PDF", r.s === 200 && r.ct.includes("pdf") && r.j.slice(0, 5).toString() === "%PDF-");
	await new Promise((x) => setTimeout(x, 1500));
	r = await call("GET", "/documents?q=IR-", A);
	t("rapport ajouté automatiquement au registre documentaire", r.j.items.some((d) => d.docType === "Report"), JSON.stringify(r.j.items.slice(0, 2)));

	// Anomalies
	r = await call("POST", "/anomalies", INS, { assetId: pipe.id, title: "Épaisseur sous t_min", priority: "P1", sourceInspectionId: inspId, actions: [{ text: "Remplacer le tronçon" }] });
	t("anomalie P1 créée avec échéance", r.s === 201 && r.j.dueDate, JSON.stringify(r.j).slice(0, 200));
	const an = r.j;
	r = await call("POST", `/anomalies/${an.id}/status`, ENG, { status: "Closed" });
	t("ACCEPTATION : clôture impossible avec une action ouverte (409)", r.s === 409, String(r.s) + JSON.stringify(r.j));
	r = await call("PUT", `/anomalies/${an.id}/actions/${an.actions[0].id}`, ENG, { done: true });
	t("action terminée", r.j.actions?.[0]?.done === true);
	r = await call("POST", `/anomalies/${an.id}/status`, ENG, { status: "Closed" });
	t("clôture acceptée quand toutes les actions sont terminées", r.s === 200 && r.j.status === "Closed", JSON.stringify(r.j).slice(0, 100));
	r = await call("POST", `/anomalies/${an.id}/status`, INS, { status: "Open" });
	t("inspecteur : changement de statut refusé (403)", r.s === 403, String(r.s));
	const st = (await call("GET", "/assets?q=HUL-STR-002", A)).j.items[0];
	const b2 = (await call("GET", "/rbi/assets/" + st.id, A)).j.evaluation;
	await call("POST", "/anomalies", A, { assetId: st.id, title: "Fissure", priority: "P2" });
	const a2 = (await call("GET", "/rbi/assets/" + st.id, A)).j.evaluation;
	t("anomalie P2 ouverte → PoF +1", a2.pof === Math.min(5, b2.pof + 1), `${b2.pof}→${a2.pof}`);

	// ACCEPTATION : changer une case de la matrice met à jour risques et échéances
	const cfg = (await call("GET", "/settings", A)).j;
	const m = cfg.matrix.map((row) => row.map(() => "H"));
	const calm = (await call("GET", "/assets?q=20-PL-2003", A)).j.items[0];
	const bR = (await call("GET", "/rbi/assets/" + calm.id, A)).j.evaluation;
	r = await call("PUT", "/settings/matrix", A, { value: m });
	t("matrice modifiée par l'administrateur", r.s === 200, JSON.stringify(r.j));
	const aR = (await call("GET", "/rbi/assets/" + calm.id, A)).j.evaluation;
	t("ACCEPTATION : risque et intervalle mis à jour immédiatement", bR.risk !== "H" && aR.riskBeforeOverdue === "H" && aR.intervalMonths === 12 && aR.intervalMonths < bR.intervalMonths, `${bR.risk}/${bR.intervalMonths} → ${aR.riskBeforeOverdue}/${aR.intervalMonths}`);
	r = await call("PUT", "/settings/matrix", ENG, { value: m });
	t("configuration réservée à l'administrateur (403)", r.s === 403);
	r = await call("PUT", "/settings/matrix", A, { value: [["X"]] });
	t("configuration invalide refusée (400)", r.s === 400);
	await call("PUT", "/settings/matrix", A, { value: cfg.matrix });
	r = await call("GET", "/audit?entity=setting", A);
	t("changement de matrice dans la piste d'audit", r.j.items.some((i) => i.entityId === "matrix" && i.action === "config_change"));
	r = await call("GET", "/audit?entity=inspection", A);
	t("inspection dans la piste d'audit", r.j.items.length > 0);

	// Table des contraintes admissibles sans CS : actifs non calculables, signalés
	const stress = cfg.allowableStress, s2 = { ...stress }; delete s2.CS;
	await call("PUT", "/settings/allowableStress", A, { value: s2 });
	const nc = (await call("GET", "/rbi/assets?notCalculable=1", A)).j;
	t("contrainte admissible absente → actifs non calculables signalés", nc.total > 0, String(nc.total));
	await call("PUT", "/settings/allowableStress", A, { value: stress });

	// Stratégie de maintenance
	r = await call("GET", "/maintenance/strategy/asset/" + first.assetId, A);
	t("stratégie recommandée par actif (intervalle RBI)", r.j.tasks.length > 0 && r.j.tasks.some((x) => x.basis === "rbi"));
	const fac = (await call("GET", "/facilities", A)).j[0].id;
	r = await call("GET", `/maintenance/strategy-document?facility=${fac}&class=PIPE&format=pdf`, A);
	t("document de stratégie PDF", r.s === 200 && r.j.slice(0, 5).toString() === "%PDF-");
	r = await call("GET", `/maintenance/strategy-document?facility=${fac}&format=docx`, A);
	t("document de stratégie Word", r.s === 200 && r.j.slice(0, 2).toString() === "PK");
	r = await call("GET", "/maintenance/end-of-life", A);
	t("actifs en fin de vie", Array.isArray(r.j));

	// Pièces
	r = await call("GET", "/materials/parts?low=1", A);
	t("alerte : pièces sous le stock minimum", r.j.length > 0 && r.j.every((p) => p.stock < p.minStock), String(r.j.length));
	r = await call("POST", "/materials/parts", RD, { code: "X", description: "x", stock: 1, minStock: 1 });
	t("lecteur : création de pièce refusée", r.s === 403);

	// Documents et fichiers
	const fd = new FormData();
	fd.append("docNumber", "TST-001"); fd.append("title", "Doc test"); fd.append("docType", "Report"); fd.append("facilityId", String(fac)); fd.append("revision", "A"); fd.append("assetIds", JSON.stringify([pipe.id]));
	fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%test content here\n")], { type: "application/pdf" }), "t.pdf");
	r = await call("POST", "/documents", A, null, fd);
	t("document créé avec fichier", r.s === 201, JSON.stringify(r.j));
	const did = r.j.id;
	const bad = new FormData();
	bad.append("docNumber", "TST-002"); bad.append("title", "x"); bad.append("docType", "Report"); bad.append("revision", "A");
	bad.append("file", new Blob(["<script>alert(1)</script>"], { type: "application/pdf" }), "evil.pdf");
	r = await call("POST", "/documents", A, null, bad);
	t("faux PDF (HTML déguisé) refusé", r.s === 400, String(r.s));
	const fd2 = new FormData();
	fd2.append("revision", "B"); fd2.append("file", new Blob([Buffer.from("%PDF-1.4\n%rev B content\n")], { type: "application/pdf" }), "t2.pdf");
	r = await call("POST", `/documents/${did}/versions`, A, null, fd2);
	t("nouvelle révision du document", r.s === 201);
	const dd = (await call("GET", "/documents/" + did, A)).j;
	t("gestion des versions : A et B conservées", dd.versions.length === 2 && dd.revision === "B");
	r = await call("GET", "/files/" + dd.versions[0].fileId, A);
	t("téléchargement du fichier", r.s === 200 && r.ct.includes("pdf"));

	// Exports
	r = await call("GET", "/export/maximo/assets?format=csv", A);
	t("export Maximo : actifs (CSV)", r.s === 200 && r.j.toString().includes("ASSETNUM"));
	r = await call("GET", "/export/maximo/pm?format=xlsx", ENG);
	t("export Maximo : plans PM (XLSX, ingénieur)", r.s === 200 && r.j.slice(0, 2).toString() === "PK");
	r = await call("GET", "/export/maximo/pm", RD);
	t("export Maximo refusé au lecteur (403)", r.s === 403);
	for (const p of ["/anomalies?format=csv", "/inspections?format=xlsx", "/rbi/assets?format=csv", "/materials/parts?format=csv", "/documents?format=csv", "/maintenance/fmea?format=csv", "/inspections/schedule?format=csv", "/anomalies/repairs?format=csv", "/rbi/criticality?format=csv", "/maintenance/end-of-life?format=csv"]) {
		r = await call("GET", p, A);
		t("export liste " + p, r.s === 200, String(r.s));
	}
	r = await call("GET", "/inspections/schedule?status=overdue", A);
	t("planning : statut En retard", r.s === 200 && r.j.every((x) => x.status === "overdue"));
	console.log("   inspections en retard :", r.j.length);
	r = await call("GET", "/anomalies/repairs", A);
	t("registre des réparations temporaires avec statut d'expiration", r.j.length > 0 && !!r.j[0].status, JSON.stringify(r.j[0]));
	r = await call("GET", "/rbi/criticality", A);
	t("synthèse de criticité par système", r.j.length === 10);
	console.log(`\n${ok} OK, ${ko} KO`);
	process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
