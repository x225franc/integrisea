const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../index");

const close = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} attendu ≈ ${expected}, obtenu ${actual}`);
const TODAY = "2026-11-20";
const cfg = (over = {}) => ({ ...E.defaultConfig(), allowableStress: { CS: 138, "22Cr Duplex": 207 }, ...over });
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };

// ---------------------------------------------------------------- dates
test("dates : addMonths conserve le jour et se ramène au dernier jour du mois", () => {
	assert.equal(E.addMonths("2024-03-15", 96), "2032-03-15");
	assert.equal(E.addMonths("2024-01-31", 1), "2024-02-29");
	assert.equal(E.addMonths("2025-01-31", 1), "2025-02-28");
	assert.equal(E.daysBetween("2026-11-20", "2026-11-21"), 1);
	close(E.yearsBetween("2024-03-15", "2026-11-20"), 980 / 365.25, 1e-9);
});

// ---------------------------------------------------------------- t_min
test("t_min tuyauterie : le plancher structurel gouverne (P=4,5 MPa, D=168,3, S=138 → 2,71 < 2,8)", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 45, odMm: 168.3, nominalThicknessMm: 7.11 }, cfg());
	assert.equal(r.ok, true);
	assert.equal(r.tCalc, 2.71); // 4,5×168,3 / (2×(138+0,4×4,5)) = 757,35 / 279,6
	assert.equal(r.tmin, 2.8);
	assert.equal(r.lines[0].params.governs, "structural");
});

test("t_min tuyauterie : la pression gouverne (P=12 MPa, D=219,1, S=207 → 6,21)", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "22Cr Duplex", designPressureBarg: 120, odMm: 219.1, nominalThicknessMm: 12.7 }, cfg());
	assert.equal(r.tmin, 6.21); // 12×219,1 / (2×(207+4,8)) = 2629,2 / 423,6
	assert.equal(r.lines[0].params.governs, "pressure");
});

test("t_min petit diamètre : plancher 2,0 mm pour D ≤ 114,3", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 40, odMm: 60.3, nominalThicknessMm: 3.91 }, cfg());
	assert.equal(r.tmin, 2.0);
});

test("t_min appareil à pression : virole cylindrique (R = D/2 − t_nom)", () => {
	const r = E.computeTmin({ classCode: "PV", material: "CS", designPressureBarg: 45, odMm: 3000, nominalThicknessMm: 60 }, cfg());
	assert.equal(r.tmin, 47.89); // 4,5×1440 / (138 − 0,6×4,5) = 6480 / 135,3
});

test("t_min : table des contraintes vide → non calculable, aucune valeur inventée", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 45, odMm: 168.3, nominalThicknessMm: 7.11 }, E.defaultConfig());
	assert.equal(r.ok, false);
	assert.equal(r.tmin, null);
	assert.deepEqual(r.missing, ["allowableStress:CS"]);
});

test("t_min : paramètres de la configuration respectés", () => {
	const c = cfg({ structuralMin: { pipeSmall: 3, pipeLarge: 4, pipeSmallMaxOdMm: 114.3, vessel: 2.5 } });
	assert.equal(E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 45, odMm: 168.3, nominalThicknessMm: 7 }, c).tmin, 4);
});

// ---------------------------------------------------------------- corrosion
const cA = { installYear: 2010, nominalThicknessMm: 10 };
test("corrosion : vitesse long terme et court terme, on retient la plus élevée", () => {
	// long terme : (10−8)/10,0014 ans = 0,19997 ; court terme : (8,5−8)/4,9993 = 0,10001
	let r = E.computeCorrosion(cA, [{ date: "2015-07-01", t: 8.5 }, { date: "2020-07-01", t: 8.0 }], E.defaultConfig());
	close(r.crLT, 0.2, 1e-3); close(r.crST, 0.1, 1e-3); close(r.cr, 0.2, 1e-3);
	// court terme (9,5−8)/4,9993 = 0,30002 > long terme
	r = E.computeCorrosion(cA, [{ date: "2015-07-01", t: 9.5 }, { date: "2020-07-01", t: 8.0 }], E.defaultConfig());
	close(r.cr, 0.3, 1e-3);
});

test("corrosion : une seule mesure → vitesse long terme seule", () => {
	const r = E.computeCorrosion(cA, [{ date: "2020-07-01", t: 8.0 }], E.defaultConfig());
	assert.equal(r.crST, undefined);
	close(r.cr, 0.2, 1e-3);
});

test("corrosion : vitesse nulle ou négative ramenée au minimum de 0,01 mm/an", () => {
	assert.equal(E.computeCorrosion(cA, [{ date: "2020-07-01", t: 10 }], E.defaultConfig()).cr, 0.01);
	const r = E.computeCorrosion(cA, [{ date: "2020-07-01", t: 10.4 }], E.defaultConfig());
	assert.equal(r.cr, 0.01);
	assert.equal(r.crFloored, true);
});

test("corrosion : les mesures sont triées par date", () => {
	const r = E.computeCorrosion(cA, [{ date: "2020-07-01", t: 8.0 }, { date: "2015-07-01", t: 9.5 }], E.defaultConfig());
	assert.equal(r.tLastDate, "2020-07-01");
});

// ---------------------------------------------------------------- PoF selon la durée de vie résiduelle
test("PoF : seuils ≥20→1, 10–20→2, 5–10→3, 2–5→4, <2→5 (bornes incluses côté supérieur)", () => {
	const f = (rl) => E.pofFromRemainingLife(rl, [20, 10, 5, 2]);
	assert.deepEqual([25, 20, 19.99, 10, 9.99, 5, 4.99, 2, 1.99, 0, -3].map(f), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5]);
});

// ---------------------------------------------------------------- évaluation RBI complète
const pipe = (over = {}) => ({
	tag: "10-PL-1015", classCode: "PIPE", tracking: "thickness", material: "CS", designPressureBarg: 45,
	odMm: 168.3, nominalThicknessMm: 7.11, installYear: 2014, crit: { s: 3, e: 2, p: 3 }, ...over,
});

test("RBI épaisseur : exemple chiffré complet (RL ≈ 25,3 ans → PoF 1, risque L, intervalle 96 mois)", () => {
	const r = E.evaluateAsset({ asset: pipe(), inspections: [{ date: "2024-03-15", readings: [{ t: 6.4 }, { t: 6.0 }, { t: 6.8 }] }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.tmin, 2.8);
	assert.equal(r.tLast, 6.0); // CML gouvernant = plus faible lecture
	close(r.cr, 0.1144, 1e-3, "vitesse"); // (7,11−6,0)/9,7057
	close(r.rlAtLast, 27.98, 0.05, "RL à la date de mesure");
	close(r.rl, 25.3, 0.05, "RL aujourd'hui"); // − 2,6831 ans écoulés
	assert.equal(r.pof, 1);
	assert.equal(r.cof, 3);
	assert.equal(r.criticality, "B");
	assert.equal(r.risk, "L");
	assert.equal(r.intervalMonths, 96);
	assert.equal(r.dueDate, "2032-03-15");
	assert.equal(r.status, "planned");
	assert.equal(r.calculable, true);
	assert.ok(r.lines.length >= 6 && r.lines.every((l) => l.code && l.params));
});

test("RBI épaisseur sous t_min : RL = 0, PoF 5, échéance dépassée, anomalie P1 proposée (critère d'acceptation)", () => {
	const input = { asset: pipe(), inspections: [{ date: "2025-06-01", readings: [{ t: 2.5 }] }], openAnomalies: [] };
	const r = E.evaluateAsset(input, cfg(), TODAY);
	assert.equal(r.rl, 0);
	assert.ok(r.rlRaw < 0);
	assert.equal(r.pof, 5);
	assert.equal(r.risk, "MH");
	assert.equal(r.intervalMonths, 0); // plafonné à la moitié de la RL (négative → 0)
	assert.equal(r.status, "overdue");
	const s = E.suggestAnomaly({ evalResult: r, grade: null }, cfg());
	assert.equal(s.priority, "P1");
	assert.equal(s.triggers[0].code, "below_tmin");
});

test("RBI : plafond de l'intervalle à la moitié de la RL", () => {
	// t_dernière 3,6 ; RL à la mesure ≈ 7 ans → ½ RL ≈ 42 mois, sous les 60 mois du niveau M
	const a = pipe({ crit: { s: 3, e: 3, p: 3 }, installYear: 2010, nominalThicknessMm: 7.11 });
	const r = E.evaluateAsset({ asset: a, inspections: [{ date: "2025-07-01", readings: [{ t: 3.6 }] }], openAnomalies: [] }, cfg(), TODAY);
	assert.ok(r.rlAtLast > 0);
	assert.equal(r.intervalMonths, Math.floor(r.rlAtLast * 6));
	assert.ok(r.lines.some((l) => l.code === "interval_cap_rl"));
});

test("RBI épaisseur : sans mesure → PoF 3 par défaut, base = 1er juillet de l'année d'installation", () => {
	const r = E.evaluateAsset({ asset: pipe(), inspections: [], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.pofBase, 3);
	assert.equal(r.baseDate, "2014-07-01");
	assert.ok(r.lines.some((l) => l.code === "no_thickness_data"));
});

test("RBI épaisseur : contrainte admissible absente → non calculable, PoF par défaut, signalé", () => {
	const r = E.evaluateAsset({ asset: pipe(), inspections: [{ date: "2024-03-15", readings: [{ t: 6 }] }], openAnomalies: [] }, E.defaultConfig(), TODAY);
	assert.equal(r.calculable, false);
	assert.ok(r.incomplete.includes("allowableStress:CS"));
	assert.equal(r.tmin, null);
	assert.equal(r.pofBase, 3);
});

const cond = (over = {}) => ({ tag: "X", classCode: "STR", tracking: "condition", installYear: 2014, crit: { s: 4, e: 1, p: 3 }, ...over });

test("RBI état : PoF = grade de la dernière inspection ; sans inspection PoF 3", () => {
	const r = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2023-01-10", grade: 2 }, { date: "2024-05-10", grade: 3 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.pofBase, 3);
	assert.equal(r.baseDate, "2024-05-10");
	const none = E.evaluateAsset({ asset: cond(), inspections: [], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(none.pofBase, 3);
	assert.equal(none.baseDate, "2014-07-01");
});

test("RBI modificateurs : +1 si anomalie P1/P2 ouverte (P3/P4 sans effet), plafonné à 5", () => {
	const base = { asset: cond(), inspections: [{ date: "2026-06-01", grade: 2 }] };
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [] }, cfg(), TODAY).pof, 2);
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [{ priority: "P3" }, { priority: "P4" }] }, cfg(), TODAY).pof, 2);
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [{ priority: "P2" }] }, cfg(), TODAY).pof, 3);
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [{ priority: "P1" }, { priority: "P2" }] }, cfg(), TODAY).pof, 3); // +1 une seule fois
	const g4 = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2026-06-01", grade: 4 }], openAnomalies: [{ priority: "P1" }] }, cfg(), TODAY);
	assert.equal(g4.pof, 5);
	assert.ok(g4.lines.some((l) => l.code === "mod_open_anomaly" ));
});

test("RBI modificateur retard : +1 de PoF et nouveau risque, l'intervalle reste celui calculé avant", () => {
	// grade 2, CoF 4 : risque M (60 mois) ; dernière inspection 2020-01-01 → échéance 2025-01-01, en retard
	const r = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2020-01-01", grade: 2 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.riskBeforeOverdue, "M");
	assert.equal(r.intervalMonths, 60);
	assert.equal(r.dueDate, "2025-01-01");
	assert.equal(r.status, "overdue");
	assert.equal(r.pof, 3);
	assert.equal(r.risk, "MH");
});

test("RBI : plafond de l'intervalle par classe (Ex = 36 mois)", () => {
	const r = E.evaluateAsset({ asset: cond({ classCode: "EX", crit: { s: 1, e: 1, p: 2 } }), inspections: [{ date: "2026-01-01", grade: 1 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.risk, "L");
	assert.equal(r.intervalMonths, 36);
	assert.ok(r.lines.some((l) => l.code === "interval_cap_class"));
});

test("RBI : changer une case de la matrice change immédiatement risque et échéance (critère d'acceptation)", () => {
	const input = { asset: pipe(), inspections: [{ date: "2024-03-15", readings: [{ t: 6.0 }] }], openAnomalies: [] };
	const before = E.evaluateAsset(input, cfg(), TODAY);
	assert.equal(before.risk, "L");
	const m = E.defaultMatrix(); m[0][2] = "H";
	const after = E.evaluateAsset(input, cfg({ matrix: m }), TODAY);
	assert.equal(after.riskBeforeOverdue, "H"); // la case modifiée est bien appliquée
	assert.equal(after.intervalMonths, 12);
	assert.equal(after.dueDate, "2025-03-15");
	assert.equal(after.status, "overdue");
	assert.equal(after.pof, 2); // +1 retard ; le risque final est relu dans la matrice : case [PoF 2, CoF 3]
	assert.equal(after.risk, "M");
});

test("RBI criticité : A si une note ≥ 4, B si max = 3, sinon C ; SCE si S ≥ 4", () => {
	const c = (crit) => E.criticality(crit, E.defaultConfig());
	assert.deepEqual([c({ s: 1, e: 4, p: 1 }).class, c({ s: 3, e: 2, p: 1 }).class, c({ s: 2, e: 2, p: 1 }).class], ["A", "B", "C"]);
	assert.equal(c({ s: 4, e: 1, p: 1 }).sce, true);
	assert.equal(c({ s: 3, e: 5, p: 5 }).sce, false);
	assert.equal(c({ s: null, e: null, p: null }).missing, true);
});

test("RBI : fonction pure — entrées non modifiées, résultat reproductible", () => {
	const input = deepFreeze({ asset: pipe(), inspections: [{ date: "2024-03-15", readings: [{ t: 6.0 }, { t: 5.5 }] }], openAnomalies: [{ priority: "P2" }] });
	const config = deepFreeze(cfg());
	const a = E.evaluateAsset(input, config, TODAY);
	const b = E.evaluateAsset(input, config, TODAY);
	assert.deepEqual(a, b);
});

test("portefeuille : agrégats du tableau de bord", () => {
	const mk = (o) => ({ pof: 3, cof: 3, criticality: "B", status: "planned", risk: "M", calculable: true, ...o });
	const s = E.summarize([mk({}), mk({ criticality: "A", status: "overdue", risk: "H", pof: 5, cof: 4 }), mk({ status: "due_soon", calculable: false })]);
	assert.deepEqual([s.assets, s.criticalA, s.overdue, s.dueSoon, s.highRisk, s.notCalculable], [3, 1, 1, 1, 1, 1]);
	assert.deepEqual(s.matrix, { "3-3": 2, "5-4": 1 });
});

// ---------------------------------------------------------------- notation des inspections
const tpl = (id) => E.defaultTemplates().find((t) => t.id === id);

test("grade PSV : écart > 3 % → 3, > 10 % → 4, étanchéité du siège non conforme → ≥ 3", () => {
	const g = (d) => E.computeGrade(tpl("PSV"), d).grade;
	assert.equal(g({ set: 100, pop: 102, seat: "Pass" }), 1);
	assert.equal(g({ set: 100, pop: 104, seat: "Pass" }), 3);
	assert.equal(g({ set: 100, pop: 111, seat: "Pass" }), 4);
	assert.equal(g({ set: 100, pop: 89, seat: "Pass" }), 4); // écart de 11 %, en valeur absolue
	assert.equal(g({ set: 100, pop: 100, seat: "Fail" }), 3);
});

test("grade structures : fissure → 4 ; revêtement > 30 % → ≥ 3 ; grade saisi conservé", () => {
	const g = (d) => E.computeGrade(tpl("STR"), d).grade;
	assert.equal(g({ grade: 1, crack: "Yes" }), 4);
	assert.equal(g({ grade: 2, coating: 31 }), 3);
	assert.equal(g({ grade: 2, coating: 30 }), 2);
	assert.equal(g({ grade: 4, coating: 0, crack: "No" }), 4);
});

test("grade Ex : grade selon le nombre de points non conformes", () => {
	const d = (fails) => Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((k, i) => [k, i < fails ? "Fail" : "Pass"]));
	assert.deepEqual([0, 1, 2, 3, 5].map((n) => E.computeGrade(tpl("EXD"), d(n)).grade), [1, 2, 3, 4, 4]);
});

test("grade : tubing (raccords) et flexibles (épreuve) ; gabarit UT sans notation", () => {
	assert.equal(E.computeGrade(tpl("SBT"), { grade: 1, loose: 0 }).grade, 1);
	assert.equal(E.computeGrade(tpl("SBT"), { grade: 1, loose: 2 }).grade, 2);
	assert.equal(E.computeGrade(tpl("SBT"), { grade: 1, loose: 4 }).grade, 3);
	assert.equal(E.computeGrade(tpl("HOSE"), { grade: 1, ptest: "Fail" }).grade, 3);
	assert.equal(E.computeGrade(tpl("UT"), { readings: [{ t: 5 }] }).grade, null);
	assert.ok(E.computeGrade(tpl("PSV"), { set: 100, pop: 111 }).reasons.some((r) => r.code === "grade_deviation"));
});

test("épaisseur gouvernante : plus faible lecture valide", () => {
	assert.equal(E.governingThickness([{ t: 6.4 }, { t: "5.9" }, { t: 0 }, { t: "x" }]), 5.9);
	assert.equal(E.governingThickness([]), null);
});

// ---------------------------------------------------------------- anomalies
test("anomalie : suggestions selon grade et RL (proposition, jamais automatique)", () => {
	const ok = { tLast: 5, tmin: 2.8, rl: 20 };
	assert.equal(E.suggestAnomaly({ evalResult: ok, grade: 2 }, cfg()), null);
	assert.equal(E.suggestAnomaly({ evalResult: ok, grade: 3 }, cfg()).priority, "P3");
	assert.equal(E.suggestAnomaly({ evalResult: ok, grade: 4 }, cfg()).priority, "P2");
	assert.equal(E.suggestAnomaly({ evalResult: { ...ok, rl: 4 }, grade: null }, cfg()).priority, "P3");
	assert.equal(E.suggestAnomaly({ evalResult: { ...ok, rl: 1.5 }, grade: null }, cfg()).priority, "P2");
	// plusieurs déclencheurs : la priorité la plus urgente l'emporte
	assert.equal(E.suggestAnomaly({ evalResult: { tLast: 2, tmin: 2.8, rl: 0 }, grade: 3 }, cfg()).priority, "P1");
});

test("anomalie : clôture impossible tant qu'une action est ouverte (critère d'acceptation)", () => {
	assert.deepEqual(E.canClose([{ done: true }, { done: false }]), { ok: false, openCount: 1 });
	assert.equal(E.canClose([{ done: true }]).ok, true);
	assert.equal(E.canClose([]).ok, true);
});

test("anomalie : échéance cible par priorité, réparations temporaires et alertes", () => {
	const c = E.defaultConfig();
	assert.deepEqual(["P1", "P2", "P3", "P4"].map((p) => E.targetDate(p, "2026-01-01", c)), ["2026-01-08", "2026-01-31", "2026-04-01", "2027-01-01"]);
	assert.equal(E.repairStatus("2026-11-10", TODAY, c).status, "expired");
	assert.equal(E.repairStatus("2026-12-10", TODAY, c).status, "expiring");
	assert.equal(E.repairStatus("2027-06-01", TODAY, c).status, "ok");
	assert.equal(E.isOverdue({ status: "Open", dueDate: "2026-11-01" }, TODAY), true);
	assert.equal(E.isOverdue({ status: "Closed", dueDate: "2026-11-01" }, TODAY), false);
});

// ---------------------------------------------------------------- configuration
test("configuration par défaut valide ; erreurs détectées sur matrice et seuils invalides", () => {
	assert.deepEqual(E.validateConfig(E.defaultConfig()), []);
	const bad = E.defaultConfig(); bad.matrix[0][0] = "X"; bad.pofThresholds = [5, 10, 2, 1];
	const errs = E.validateConfig(bad);
	assert.equal(errs.length, 2);
	assert.deepEqual(E.defaultConfig().allowableStress, {});
});
