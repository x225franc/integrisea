const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../index");

const close = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} attendu ≈ ${expected}, obtenu ${actual}`);
const TODAY = "2026-11-20";
/** Table de contraintes plate sur −29…200 °C (valeurs de test). */
const flat = (s) => ({ points: [{ tempC: -29, s }, { tempC: 200, s }] });
const cfg = (over = {}) => ({ ...E.defaultConfig(), allowableStress: { CS: flat(138), "22Cr Duplex": flat(207), "316L": flat(115) }, materialFamilies: { "22Cr Duplex": "cra", "316L": "cra" }, ...over });
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };

// ---------------------------------------------------------------- dates
test("dates : addMonths conserve le jour et se ramène au dernier jour du mois", () => {
	assert.equal(E.addMonths("2024-03-15", 96), "2032-03-15");
	assert.equal(E.addMonths("2024-01-31", 1), "2024-02-29");
	assert.equal(E.addMonths("2025-01-31", 1), "2025-02-28");
	assert.equal(E.daysBetween("2026-11-20", "2026-11-21"), 1);
	close(E.yearsBetween("2024-03-15", "2026-11-20"), 980 / 365.25, 1e-9);
});

// ---------------------------------------------------------------- §1.2 contraintes admissibles : matériau × température
const T = { points: [{ tempC: 20, s: 150 }, { tempC: 100, s: 130 }, { tempC: 200, s: 110 }] };

test("S(T) : interpolation linéaire — à 60 °C entre (20 ; 150) et (100 ; 130) → 140 MPa", () => {
	const c = { allowableStress: { X: T } };
	const r = E.allowableStressAt("X", 60, c);
	assert.equal(r.ok, true); assert.equal(r.interpolated, true); assert.equal(r.s, 140);
	assert.equal(E.allowableStressAt("X", 150, c).s, 120); // entre (100 ; 130) et (200 ; 110)
	assert.deepEqual([E.allowableStressAt("X", 20, c).s, E.allowableStressAt("X", 100, c).s, E.allowableStressAt("X", 200, c).interpolated], [150, 130, false]); // points exacts
});

test("S(T) : pas d'extrapolation — hors plage, matériau absent ou température absente → non disponible", () => {
	const c = { allowableStress: { X: T } };
	assert.deepEqual([E.allowableStressAt("X", 19.9, c).reason, E.allowableStressAt("X", 200.1, c).reason], ["range", "range"]);
	assert.deepEqual(E.allowableStressAt("X", 19.9, c).range, [20, 200]);
	assert.equal(E.allowableStressAt("Y", 60, c).reason, "material");
	assert.equal(E.allowableStressAt("X", NaN, c).reason, "temperature");
});

test("t_min : S interpolé à la température de calcul (tuyauterie P=12 MPa, D=219,1, 60 °C → S=140 → 9,08 mm)", () => {
	const asset = { classCode: "PIPE", material: "X", designPressureBarg: 120, designTempC: 60, odMm: 219.1, nominalThicknessMm: 12.7 };
	const r = E.computeTmin(asset, cfg({ allowableStress: { X: T } }));
	assert.equal(r.ok, true);
	assert.equal(r.tmin, 9.08); // 12×219,1 / (2×(140+0,4×12)) = 2629,2 / 289,6
	assert.ok(r.lines.some((l) => l.code === "stress_interpolated" && l.params.s === 140));
	// un autre point de température donne un autre résultat : S(150) = 120 → 12×219,1 / (2×(120+4,8)) = 10,53
	assert.equal(E.computeTmin({ ...asset, designTempC: 150 }, cfg({ allowableStress: { X: T } })).tmin, 10.53);
});

test("t_min : hors plage de température ou température absente → non calculable (aucune extrapolation)", () => {
	const base = { classCode: "PIPE", material: "X", designPressureBarg: 120, odMm: 219.1, nominalThicknessMm: 12.7 };
	const c = cfg({ allowableStress: { X: T } });
	const out = E.computeTmin({ ...base, designTempC: 250 }, c);
	assert.equal(out.ok, false); assert.equal(out.tmin, null); assert.deepEqual(out.missing, ["allowableStressRange:X"]);
	assert.deepEqual(E.computeTmin({ ...base, designTempC: null }, c).missing, ["designTempC"]);
});

// ---------------------------------------------------------------- t_min : tuyauterie et structurel
test("t_min tuyauterie : le plancher structurel gouverne (P=4,5 MPa, D=168,3, S=138 → 2,71 < 2,8)", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 45, designTempC: 80, odMm: 168.3, nominalThicknessMm: 7.11 }, cfg());
	assert.equal(r.ok, true);
	assert.equal(r.tCalc, 2.71); // 4,5×168,3 / (2×(138+0,4×4,5)) = 757,35 / 279,6
	assert.equal(r.tmin, 2.8);
	assert.equal(r.lines.find((l) => l.code === "tmin").params.governs, "structural");
});

test("t_min tuyauterie : la pression gouverne (P=12 MPa, D=219,1, S=207 → 6,21)", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "22Cr Duplex", designPressureBarg: 120, designTempC: 80, odMm: 219.1, nominalThicknessMm: 12.7 }, cfg());
	assert.equal(r.tmin, 6.21); // 12×219,1 / (2×(207+4,8)) = 2629,2 / 423,6
	assert.equal(r.lines.find((l) => l.code === "tmin").params.governs, "pressure");
});

test("t_min : table des plafonds structurels par plage de diamètre (2,0 mm ≤ 114,3 ; 2,8 mm au-delà ; plage supplémentaire)", () => {
	const a = (od) => ({ classCode: "PIPE", material: "CS", designPressureBarg: 40, designTempC: 80, odMm: od, nominalThicknessMm: 3.91 });
	assert.equal(E.computeTmin(a(60.3), cfg()).tmin, 2.0);
	assert.equal(E.computeTmin(a(114.3), cfg()).tmin, 2.0);
	assert.equal(E.computeTmin(a(168.3), cfg()).tmin, 2.8);
	const three = cfg({ structuralMin: { pipe: [{ maxOdMm: 60.3, min: 1.6 }, { maxOdMm: 273.1, min: 3.0 }, { maxOdMm: null, min: 4.5 }], vessel: 2.5 } });
	assert.deepEqual([60.3, 168.3, 273.1, 323.9].map((od) => E.computeTmin(a(od), three).tStruct), [1.6, 3.0, 3.0, 4.5]);
});

// ---------------------------------------------------------------- §1.3 formule des appareils : rayon extérieur
test("t_min virole : formule au rayon extérieur t = P·Ro/(S·E+0,4·P) — P=4,5 MPa, D=3000, S=138 → 48,28 mm", () => {
	const asset = { classCode: "PV", material: "CS", designPressureBarg: 45, designTempC: 90, odMm: 3000, nominalThicknessMm: 60 };
	const r = E.computeTmin(asset, cfg());
	assert.equal(r.tmin, 48.28); // 4,5×1500 / (138 + 0,4×4,5) = 6750 / 139,8
	assert.equal(r.lines.find((l) => l.code === "tmin").params.Ro, 1500);
	assert.ok(r.lines.some((l) => l.code === "tmin_scope" && l.params.formula === "vessel")); // périmètre et exclusions rappelés
});

test("t_min virole : indépendant de l'épaisseur (reste valable quand la paroi s'amincit)", () => {
	const mk = (nom) => ({ classCode: "PV", material: "CS", designPressureBarg: 45, designTempC: 90, odMm: 3000, nominalThicknessMm: nom });
	assert.equal(E.computeTmin(mk(60), cfg()).tmin, E.computeTmin(mk(30), cfg()).tmin);
	assert.equal(E.computeTmin(mk(49), cfg()).tmin, 48.28);
});

test("t_min : table des contraintes vide → non calculable, aucune valeur inventée", () => {
	const r = E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 45, designTempC: 80, odMm: 168.3, nominalThicknessMm: 7.11 }, E.defaultConfig());
	assert.equal(r.ok, false);
	assert.equal(r.tmin, null);
	assert.deepEqual(r.missing, ["allowableStress:CS"]);
});

test("t_min : paramètres de la configuration respectés", () => {
	const c = cfg({ structuralMin: { pipe: [{ maxOdMm: 114.3, min: 3 }, { maxOdMm: null, min: 4 }], vessel: 2.5 } });
	assert.equal(E.computeTmin({ classCode: "PIPE", material: "CS", designPressureBarg: 45, designTempC: 80, odMm: 168.3, nominalThicknessMm: 7 }, c).tmin, 4);
});

// ---------------------------------------------------------------- §1.1 et §2.2 corrosion et durée de vie résiduelle PAR CML
const asset10 = { material: "CS", installYear: 2010, nominalThicknessMm: 10 };
const insp = (date, readings) => ({ date, readings });
const cml = (id, t) => ({ cml: id, t });
const cmlOf = (r, id) => r.cmls.find((c) => c.id === id);

test("CML : vitesse long terme depuis la 1re mesure du CML, court terme entre les deux dernières ; on retient la plus élevée", () => {
	// CML-01 : 9,0 (2015-07-01) → 8,5 (2020-07-01) → 8,0 (2024-07-01)
	const r = E.computeCmlCorrosion(asset10, [insp("2015-07-01", [cml("CML-01", 9.0)]), insp("2020-07-01", [cml("CML-01", 8.5)]), insp("2024-07-01", [cml("CML-01", 8.0)])], 2.0, cfg(), TODAY);
	const c = cmlOf(r, "CML-01");
	assert.equal(c.refKind, "first"); assert.equal(c.tRef, 9.0);
	close(c.crLT, 1.0 / 9.0014, 1e-4); // (9,0 − 8,0) / 9,0014 ans = 0,1111
	close(c.crST, 0.5 / 4.0014, 1e-4); // (8,5 − 8,0) / 4,0014 ans = 0,1250
	close(c.cr, 0.125, 1e-3); // court terme > long terme
	assert.equal(c.floored, false);
});

test("CML : une seule mesure → vitesse long terme seule, depuis t_nom au 1er juillet de l'année d'installation", () => {
	const r = E.computeCmlCorrosion(asset10, [insp("2020-07-01", [cml("CML-01", 8.0)])], 2.0, cfg(), TODAY);
	const c = cmlOf(r, "CML-01");
	assert.equal(c.refKind, "nominal"); assert.equal(c.crST, undefined);
	close(c.cr, 2 / 10.0014, 1e-3); // (10 − 8) / 10,0014 = 0,2
});

test("CML : un CML à une seule mesure sans nominal ni année d'installation n'a pas de référence (sert à l'inspection suivante)", () => {
	const r = E.computeCmlCorrosion({ material: "CS" }, [insp("2020-07-01", [cml("CML-01", 8.0)])], 2.0, cfg(), TODAY);
	assert.equal(cmlOf(r, "CML-01").usable, false);
	assert.equal(r.governing, null);
	assert.ok(r.lines.some((l) => l.code === "cml_no_reference"));
	// à l'inspection suivante, la référence est la 1re mesure du CML
	const r2 = E.computeCmlCorrosion({ material: "CS" }, [insp("2020-07-01", [cml("CML-01", 8.0)]), insp("2024-07-01", [cml("CML-01", 7.6)])], 2.0, cfg(), TODAY);
	assert.equal(cmlOf(r2, "CML-01").usable, true); assert.equal(cmlOf(r2, "CML-01").tRef, 8.0);
});

test("CML : comparer les emplacements entre eux est faux — RL par CML, la plus faible gouverne (exemple chiffré)", () => {
	// 2018-07-01 : A 8,0 ; B 9,0   |   2024-07-01 : A 7,9 ; B 7,5.   t_min = 2,0
	// Ancienne méthode (minimum de chaque inspection) : (8,0 → 7,5) → 0,083 mm/an → RL 66 ans : trompeuse.
	const r = E.computeCmlCorrosion(asset10, [insp("2018-07-01", [cml("A", 8.0), cml("B", 9.0)]), insp("2024-07-01", [cml("A", 7.9), cml("B", 7.5)])], 2.0, cfg(), TODAY);
	const A = cmlOf(r, "A"), B = cmlOf(r, "B");
	close(A.crLT, 0.1 / 6.0014, 1e-4); // 0,0167 → relevé au plancher 0,05 (acier carbone)
	assert.equal(A.cr, 0.05); assert.equal(A.floored, true);
	close(B.cr, 1.5 / 6.0014, 1e-4); // 0,2499 mm/an
	close(B.rlAtLast, (7.5 - 2.0) / B.cr, 1e-9); // 22,0 ans à la date de mesure
	close(B.rlRaw, B.rlAtLast - 872 / 365.25, 1e-6); // − 2,387 ans écoulés
	close(B.rlRaw, 19.62, 0.02);
	assert.equal(r.governing, "B");
	close(A.rlRaw, (7.9 - 2.0) / 0.05 - 872 / 365.25, 1e-6); // ≈ 115,6 ans
});

test("CML : l'évaluation d'actif reprend la RL du CML gouvernant et expose une série par CML", () => {
	const input = { asset: { tag: "P1", classCode: "PIPE", tracking: "thickness", material: "CS", designPressureBarg: 45, designTempC: 80, odMm: 168.3, nominalThicknessMm: 10, installYear: 2010, crit: { s: 3, e: 2, p: 3 } },
		inspections: [insp("2018-07-01", [cml("A", 8.0), cml("B", 9.0)]), insp("2024-07-01", [cml("A", 7.9), cml("B", 7.5)])], openAnomalies: [] };
	const r = E.evaluateAsset(input, cfg(), TODAY);
	assert.equal(r.governingCml, "B");
	assert.equal(r.tLast, 7.5);
	assert.equal(r.cmls.length, 2);
	close(r.rl, 16.42, 0.02); // t_min = 2,8 ici : (7,5 − 2,8) / 0,2499 − 2,387 ans écoulés = 16,42
	assert.ok(r.lines.filter((l) => l.code === "corrosion_cml").length === 2);
});

test("CML : plancher de vitesse par famille — acier carbone 0,05 ; alliage résistant 0,01 ; famille inconnue → carbone", () => {
	const meas = [insp("2020-07-01", [cml("CML-01", 9.99)])]; // vitesse brute (10 − 9,99)/10,0014 ≈ 0,001 mm/an
	const run = (material) => cmlOf(E.computeCmlCorrosion({ ...asset10, material }, meas, 2.0, cfg(), TODAY), "CML-01");
	assert.equal(run("CS").cr, 0.05); assert.equal(run("CS").family, "carbon");
	assert.equal(run("316L").cr, 0.01); assert.equal(run("316L").family, "cra");
	assert.equal(run("22Cr Duplex").cr, 0.01);
	assert.equal(run("Matériau inconnu").cr, 0.05); assert.equal(run("Matériau inconnu").family, "carbon");
	assert.equal(E.corrosionFloor("Matériau inconnu", cfg()).known, false);
	// vitesse négative (épaisseur qui « augmente ») → plancher
	assert.equal(cmlOf(E.computeCmlCorrosion(asset10, [insp("2020-07-01", [cml("CML-01", 10.4)])], 2.0, cfg(), TODAY), "CML-01").cr, 0.05);
	// plancher modifiable
	const c2 = cfg({ corrosionFloors: { carbon: 0.08, cra: 0.02 } });
	assert.equal(cmlOf(E.computeCmlCorrosion(asset10, meas, 2.0, c2, TODAY), "CML-01").cr, 0.08);
});

test("CML : relevés triés par date, CML identifiés sans tenir compte de la casse", () => {
	const r = E.computeCmlCorrosion(asset10, [insp("2024-07-01", [cml("cml-01", 7.0)]), insp("2018-07-01", [cml("CML-01", 9.0)])], 2.0, cfg(), TODAY);
	assert.equal(r.cmls.length, 1);
	assert.equal(r.cmls[0].tRef, 9.0); assert.equal(r.cmls[0].lastDate, "2024-07-01");
});

// ---------------------------------------------------------------- PoF selon la durée de vie résiduelle
test("PoF : seuils ≥20→1, 10–20→2, 5–10→3, 2–5→4, <2→5 (bornes incluses côté supérieur)", () => {
	const f = (rl) => E.pofFromRemainingLife(rl, [20, 10, 5, 2]);
	assert.deepEqual([25, 20, 19.99, 10, 9.99, 5, 4.99, 2, 1.99, 0, -3].map(f), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5]);
});

// ---------------------------------------------------------------- évaluation RBI complète
const pipe = (over = {}) => ({
	tag: "10-PL-1015", classCode: "PIPE", tracking: "thickness", material: "CS", designPressureBarg: 45, designTempC: 80,
	odMm: 168.3, nominalThicknessMm: 7.11, installYear: 2014, crit: { s: 3, e: 2, p: 3 }, ...over,
});

test("RBI épaisseur : exemple chiffré complet (RL ≈ 25,3 ans → PoF 1, risque L, intervalle 96 mois)", () => {
	const r = E.evaluateAsset({ asset: pipe(), inspections: [{ date: "2024-03-15", readings: [cml("CML-01", 6.4), cml("CML-02", 6.0), cml("CML-03", 6.8)] }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.tmin, 2.8);
	assert.equal(r.governingCml, "CML-02"); // plus faible RL (et plus forte vitesse)
	assert.equal(r.tLast, 6.0);
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
	const input = { asset: pipe(), inspections: [{ date: "2025-06-01", readings: [cml("CML-01", 2.5)] }], openAnomalies: [] };
	const r = E.evaluateAsset(input, cfg(), TODAY);
	assert.equal(r.rl, 0);
	assert.ok(r.rlRaw < 0);
	assert.equal(r.pof, 5);
	assert.equal(r.risk, "MH");
	assert.equal(r.intervalMonths, 0); // plafonné à la moitié de la RL (négative → 0)
	assert.equal(r.status, "overdue");
	assert.equal(r.belowTmin, true);
	const s = E.suggestAnomaly({ evalResult: r, grade: null }, cfg());
	assert.equal(s.priority, "P1");
	assert.equal(s.triggers[0].code, "below_tmin");
});

test("RBI : un CML sous t_min suffit, même s'il n'est pas le CML gouvernant (PoF 5 et P1)", () => {
	// CML « mince » mesuré une seule fois sans référence exploitable + CML sain avec historique
	const a = pipe({ installYear: null });
	const input = { asset: a, inspections: [insp("2020-07-01", [cml("A", 6.0), cml("B", 7.0)]), insp("2025-07-01", [cml("A", 5.9), cml("B", 2.5)])], openAnomalies: [] };
	const r = E.evaluateAsset(input, cfg(), TODAY);
	assert.equal(r.belowTmin, true); assert.equal(r.tMeasuredMin, 2.5);
	assert.equal(r.pof, 5);
	assert.equal(E.suggestAnomaly({ evalResult: r, grade: null }, cfg()).priority, "P1");
});

test("RBI : plafond de l'intervalle à la moitié de la RL (RL à la date de la dernière mesure)", () => {
	const a = pipe({ crit: { s: 3, e: 3, p: 3 }, installYear: 2010 });
	const r = E.evaluateAsset({ asset: a, inspections: [{ date: "2025-07-01", readings: [cml("CML-01", 3.6)] }], openAnomalies: [] }, cfg(), TODAY);
	assert.ok(r.rlAtLast > 0);
	assert.equal(r.intervalMonths, Math.floor(r.rlAtLast * 6));
	assert.ok(r.lines.some((l) => l.code === "interval_cap_rl"));
});

test("RBI : plafond « moitié de la RL » seulement pour les actifs suivis en épaisseur", () => {
	const r = E.evaluateAsset({ asset: { tag: "S", classCode: "STR", tracking: "condition", installYear: 2014, crit: { s: 2, e: 1, p: 1 } }, inspections: [{ date: "2026-06-01", grade: 1 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.intervalMonths, 96); // L : 96 mois, aucun plafond de RL
	assert.ok(!r.lines.some((l) => l.code === "interval_cap_rl"));
});

// §1.4 actif jamais inspecté
test("PoF par défaut d'un actif jamais inspecté : 4 si CoF ≥ 4, sinon 3 (épaisseur et état)", () => {
	const none = (a) => E.evaluateAsset({ asset: a, inspections: [], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(none(pipe({ crit: { s: 3, e: 2, p: 3 } })).pofBase, 3); // CoF 3
	assert.equal(none(pipe({ crit: { s: 4, e: 1, p: 1 } })).pofBase, 4); // CoF 4
	assert.equal(none(pipe({ crit: { s: 5, e: 5, p: 5 } })).pofBase, 4); // CoF 5
	assert.equal(none({ tag: "S", classCode: "STR", tracking: "condition", installYear: 2014, crit: { s: 4, e: 1, p: 1 } }).pofBase, 4);
	assert.equal(none({ tag: "S", classCode: "STR", tracking: "condition", installYear: 2014, crit: { s: 2, e: 1, p: 1 } }).pofBase, 3);
	const r = none(pipe());
	assert.equal(r.baseDate, "2014-07-01"); // base = 1er juillet de l'année d'installation
	assert.ok(r.lines.some((l) => l.code === "pof_default" && l.params.reason === "no_inspection")); // « aucune inspection — PoF par défaut conservateur »
	// valeurs configurables
	const c = cfg({ defaultPof: { cofFrom: 3, high: 5, low: 2 } });
	assert.equal(E.evaluateAsset({ asset: pipe(), inspections: [], openAnomalies: [] }, c, TODAY).pofBase, 5);
});

test("RBI épaisseur : contrainte admissible absente → non calculable, PoF par défaut, signalé", () => {
	const r = E.evaluateAsset({ asset: pipe(), inspections: [{ date: "2024-03-15", readings: [cml("CML-01", 6)] }], openAnomalies: [] }, E.defaultConfig(), TODAY);
	assert.equal(r.calculable, false);
	assert.ok(r.incomplete.includes("allowableStress:CS"));
	assert.equal(r.tmin, null);
	assert.equal(r.pofBase, 3);
	assert.ok(r.lines.some((l) => l.code === "pof_default" && l.params.reason === "tmin_missing"));
});

test("RBI épaisseur : température hors plage de la table → non calculable (pas d'extrapolation)", () => {
	const r = E.evaluateAsset({ asset: pipe({ designTempC: 250 }), inspections: [{ date: "2024-03-15", readings: [cml("CML-01", 6)] }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.calculable, false);
	assert.ok(r.incomplete.includes("allowableStressRange:CS"));
});

const cond = (over = {}) => ({ tag: "X", classCode: "STR", tracking: "condition", installYear: 2014, crit: { s: 4, e: 1, p: 3 }, ...over });

// §1.6 grade → PoF
test("RBI état : PoF = f(grade de la dernière inspection) — table 1→1, 2→2, 3→3, 4→5", () => {
	const r = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2023-01-10", grade: 2 }, { date: "2024-05-10", grade: 3 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.pofBase, 3);
	assert.equal(r.baseDate, "2024-05-10");
	const pof = (grade) => E.evaluateAsset({ asset: cond(), inspections: [{ date: "2026-06-01", grade }], openAnomalies: [] }, cfg(), TODAY).pofBase;
	assert.deepEqual([1, 2, 3, 4].map(pof), [1, 2, 3, 5]);
});

test("RBI état : grade 4 (action immédiate) atteint PoF 5 sans modificateur ; table configurable", () => {
	const r = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2026-06-01", grade: 4 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.pofBase, 5); assert.equal(r.pof, 5);
	assert.ok(!r.lines.some((l) => l.code.startsWith("mod_")));
	const c = cfg({ gradeToPof: [1, 1, 2, 4] });
	assert.deepEqual([1, 2, 3, 4].map((g) => E.evaluateAsset({ asset: cond(), inspections: [{ date: "2026-06-01", grade: g }], openAnomalies: [] }, c, TODAY).pofBase), [1, 1, 2, 4]);
});

test("RBI modificateurs : +1 si anomalie P1/P2 ouverte (P3/P4 sans effet), plafonné à 5", () => {
	const base = { asset: cond(), inspections: [{ date: "2026-06-01", grade: 2 }] };
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [] }, cfg(), TODAY).pof, 2);
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [{ priority: "P3" }, { priority: "P4" }] }, cfg(), TODAY).pof, 2);
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [{ priority: "P2" }] }, cfg(), TODAY).pof, 3);
	assert.equal(E.evaluateAsset({ ...base, openAnomalies: [{ priority: "P1" }, { priority: "P2" }] }, cfg(), TODAY).pof, 3); // +1 une seule fois
	const g4 = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2026-06-01", grade: 4 }], openAnomalies: [{ priority: "P1" }] }, cfg(), TODAY);
	assert.equal(g4.pof, 5);
	assert.ok(g4.lines.some((l) => l.code === "mod_open_anomaly_capped"));
	const g3 = E.evaluateAsset({ asset: cond(), inspections: [{ date: "2026-06-01", grade: 3 }], openAnomalies: [{ priority: "P1" }] }, cfg(), TODAY);
	assert.ok(g3.lines.some((l) => l.code === "mod_open_anomaly"));
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
	const input = { asset: pipe(), inspections: [{ date: "2024-03-15", readings: [cml("CML-01", 6.0)] }], openAnomalies: [] };
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

// §1.5 conséquence inconnue
test("CoF inconnue : sans note ni fluide connu → CoF 5 (conservateur), actif signalé incomplet", () => {
	assert.equal(E.defaultConfig().defaultConsequence, 5);
	const c = E.criticality({ s: null, e: null, p: null }, E.defaultConfig());
	assert.deepEqual([c.cof, c.class, c.missing], [5, "A", true]);
	const r = E.evaluateAsset({ asset: cond({ crit: { s: null, e: null, p: null } }), inspections: [{ date: "2026-06-01", grade: 1 }], openAnomalies: [] }, cfg(), TODAY);
	assert.equal(r.cof, 5);
	assert.ok(r.incomplete.includes("consequence")); assert.equal(r.calculable, false);
	assert.ok(r.lines.some((l) => l.code === "consequence_default"));
});

test("RBI criticité : A si une note ≥ 4, B si max = 3, sinon C ; SCE si S ≥ 4", () => {
	const c = (crit) => E.criticality(crit, E.defaultConfig());
	assert.deepEqual([c({ s: 1, e: 4, p: 1 }).class, c({ s: 3, e: 2, p: 1 }).class, c({ s: 2, e: 2, p: 1 }).class], ["A", "B", "C"]);
	assert.equal(c({ s: 4, e: 1, p: 1 }).sce, true);
	assert.equal(c({ s: 3, e: 5, p: 5 }).sce, false);
	assert.equal(c({ s: null, e: null, p: null }).missing, true);
});

test("RBI : fonction pure — entrées non modifiées, résultat reproductible", () => {
	const input = deepFreeze({ asset: pipe(), inspections: [{ date: "2024-03-15", readings: [cml("CML-01", 6.0), cml("CML-02", 5.5)] }], openAnomalies: [{ priority: "P2" }] });
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

// §3 gabarit Ex : gravité par point de contrôle
const exData = (fails) => Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((k) => [k, fails.includes(k) ? "Fail" : "Pass"]));
test("grade Ex : un point CRITIQUE non conforme (certificat, chemin de flamme, presse-étoupes, terre) → grade ≥ 3", () => {
	const g = (f) => E.computeGrade(tpl("EXD"), exData(f)).grade;
	assert.equal(g([]), 1);
	for (const k of ["c1", "c3", "c4", "c5"]) assert.equal(g([k]), 3, `point critique ${k}`);
});

test("grade Ex : un autre point non conforme → ≥ 2 ; 3 points non conformes ou plus → 4", () => {
	const g = (f) => E.computeGrade(tpl("EXD"), exData(f)).grade;
	assert.equal(g(["c2"]), 2); assert.equal(g(["c6"]), 2);
	assert.equal(g(["c2", "c6"]), 2); // deux points non critiques : reste 2
	assert.equal(g(["c1", "c2"]), 3);
	assert.equal(g(["c2", "c6", "c1"]), 4); // trois points
	assert.equal(g(["c1", "c2", "c3", "c4", "c5", "c6"]), 4);
});

test("grade Ex : la gravité de chaque point est portée par le gabarit (configurable)", () => {
	const t = JSON.parse(JSON.stringify(tpl("EXD")));
	t.fields.find((f) => f.k === "c2").sev = "critical"; // on promeut « enceinte et verre » en point critique
	t.fields.find((f) => f.k === "c1").sev = undefined; // et on rétrograde « marquage »
	assert.equal(E.computeGrade(t, exData(["c2"])).grade, 3);
	assert.equal(E.computeGrade(t, exData(["c1"])).grade, 2);
	assert.ok(E.computeGrade(tpl("EXD"), exData(["c1"])).reasons.some((r) => r.code === "grade_fail_critical"));
});

test("grade : tubing (raccords), flexibles (épreuve), annulaire ; gabarit UT sans notation", () => {
	assert.equal(E.computeGrade(tpl("SBT"), { grade: 1, loose: 0 }).grade, 1);
	assert.equal(E.computeGrade(tpl("SBT"), { grade: 1, loose: 2 }).grade, 2);
	assert.equal(E.computeGrade(tpl("SBT"), { grade: 1, loose: 4 }).grade, 3);
	assert.equal(E.computeGrade(tpl("HOSE"), { grade: 1, ptest: "Fail" }).grade, 3);
	assert.equal(E.computeGrade(tpl("ANN"), { grade: 1, vent: "Fail" }).grade, 3);
	assert.equal(E.computeGrade(tpl("UT"), { readings: [{ t: 5 }] }).grade, null);
	assert.ok(E.computeGrade(tpl("PSV"), { set: 100, pop: 111 }).reasons.some((r) => r.code === "grade_deviation"));
});

test("épaisseur gouvernante : plus faible lecture valide", () => {
	assert.equal(E.governingThickness([{ t: 6.4 }, { t: "5.9" }, { t: 0 }, { t: "x" }]), 5.9);
	assert.equal(E.governingThickness([]), null);
});

// ---------------------------------------------------------------- §4 anomalies
test("anomalie : suggestions — épaisseur < t_min → P1 ; RL < 2 → P1 ; RL < 5 → P3 ; grade 4 → P2 ; grade 3 → P3", () => {
	const ok = { tLast: 5, tmin: 2.8, rl: 20 };
	assert.equal(E.suggestAnomaly({ evalResult: ok, grade: 2 }, cfg()), null);
	assert.equal(E.suggestAnomaly({ evalResult: ok, grade: 3 }, cfg()).priority, "P3");
	assert.equal(E.suggestAnomaly({ evalResult: ok, grade: 4 }, cfg()).priority, "P2");
	assert.equal(E.suggestAnomaly({ evalResult: { ...ok, rl: 4 }, grade: null }, cfg()).priority, "P3");
	assert.equal(E.suggestAnomaly({ evalResult: { ...ok, rl: 1.5 }, grade: null }, cfg()).priority, "P1"); // modifié : était P2
	assert.equal(E.defaultConfig().anomalySuggestion.rlUnder2, "P1");
	// plusieurs déclencheurs : la priorité la plus urgente l'emporte
	assert.equal(E.suggestAnomaly({ evalResult: { belowTmin: true, tMeasuredMin: 2, tmin: 2.8, rl: 0 }, grade: 3 }, cfg()).priority, "P1");
	assert.equal(E.suggestAnomaly({ evalResult: { ...ok, rl: 4 }, grade: 4 }, cfg()).priority, "P2");
});

test("anomalie : clôture impossible tant qu'une action est ouverte (critère d'acceptation)", () => {
	assert.deepEqual(E.canClose([{ done: true }, { done: false }]), { ok: false, openCount: 1 });
	assert.equal(E.canClose([{ done: true }]).ok, true);
	assert.equal(E.canClose([]).ok, true);
});

test("anomalie : échéance cible par priorité ; réparation temporaire : alerte 90 jours avant expiration", () => {
	const c = E.defaultConfig();
	assert.deepEqual(["P1", "P2", "P3", "P4"].map((p) => E.targetDate(p, "2026-01-01", c)), ["2026-01-08", "2026-01-31", "2026-04-01", "2027-01-01"]);
	assert.equal(c.repairAlertDays, 90);
	assert.equal(E.repairStatus("2026-11-10", TODAY, c).status, "expired");
	assert.equal(E.repairStatus("2026-12-10", TODAY, c).status, "expiring");
	assert.equal(E.repairStatus("2027-02-10", TODAY, c).status, "expiring"); // 82 jours : dans la fenêtre de 90 jours
	assert.equal(E.repairStatus("2027-02-25", TODAY, c).status, "ok"); // 97 jours
	assert.equal(E.isOverdue({ status: "Open", dueDate: "2026-11-01" }, TODAY), true);
	assert.equal(E.isOverdue({ status: "Closed", dueDate: "2026-11-01" }, TODAY), false);
});

// ---------------------------------------------------------------- configuration
test("configuration par défaut valide ; erreurs détectées sur matrice et seuils invalides", () => {
	assert.deepEqual(E.validateConfig(E.defaultConfig()), []);
	const bad = E.defaultConfig(); bad.matrix[0][0] = "X"; bad.pofThresholds = [5, 10, 2, 1];
	assert.equal(E.validateConfig(bad).length, 2);
	assert.deepEqual(E.defaultConfig().allowableStress, {}); // table vide par défaut
});

test("configuration : valeurs par défaut provisoires du §2 et contrôle des nouvelles clés", () => {
	const d = E.defaultConfig();
	assert.deepEqual(d.corrosionFloors, { carbon: 0.05, cra: 0.01 });
	assert.deepEqual(d.gradeToPof, [1, 2, 3, 5]);
	assert.deepEqual(d.defaultPof, { cofFrom: 4, high: 4, low: 3 });
	assert.deepEqual(d.intervals, { L: 96, M: 60, MH: 36, H: 12 });
	assert.deepEqual(d.disciplines, ["Pressure Systems", "Structural", "Pipelines"]);
	const bad = (patch) => E.validateConfig({ ...d, ...patch }).length;
	assert.equal(bad({ allowableStress: { CS: { points: [{ tempC: 100, s: 130 }, { tempC: 20, s: 150 }] } } }), 1); // températures non croissantes
	assert.equal(bad({ allowableStress: { CS: { points: [] } } }), 1);
	assert.equal(bad({ gradeToPof: [1, 3, 2, 5] }), 1); // doit être croissant
	assert.equal(bad({ materialFamilies: { CS: "autre" } }), 1);
	assert.equal(bad({ structuralMin: { pipe: [{ maxOdMm: 100, min: 2 }], vessel: 2.5 } }), 0); // la dernière plage sans limite n'est pas obligatoire : D hors plage → dernière ligne
});
