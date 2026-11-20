// Configuration par défaut du moteur. Tout est modifiable par l'administrateur (Configuration) ;
// ces valeurs sont PROVISOIRES (phase de test, bonnes pratiques) et à arbitrer par des ingénieurs intégrité qualifiés.

const LEVELS = ["L", "M", "MH", "H"];
const DISCIPLINES = ["Pressure Systems", "Structural", "Pipelines"];
const FAMILIES = ["carbon", "cra"];

/** Matrice 5×5 : ligne = PoF 1..5, colonne = CoF 1..5. Défaut : somme PoF+CoF (matrice provisoire). */
function defaultMatrix() {
	return Array.from({ length: 5 }, (_, p) =>
		Array.from({ length: 5 }, (_, c) => {
			const s = p + c + 2;
			return s <= 4 ? "L" : s <= 6 ? "M" : s <= 8 ? "MH" : "H";
		}));
}

/** Discipline par défaut des classes d'actifs (modifiable sur chaque actif). EX est provisoire, à confirmer. */
const DEFAULT_CLASS_DISCIPLINE = {
	PV: "Pressure Systems", HX: "Pressure Systems", PSV: "Pressure Systems", PIPE: "Pressure Systems", SBT: "Pressure Systems", HOSE: "Pressure Systems",
	STR: "Structural", RISER: "Pipelines", EX: "Pressure Systems",
};

function defaultConfig() {
	return {
		matrix: defaultMatrix(),
		// Intervalle maximal (mois) par niveau de risque.
		intervals: { L: 96, M: 60, MH: 36, H: 12 },
		// Intervalle maximal (mois) par classe d'équipement.
		classMaxInterval: { EX: 36, PSV: 36, HOSE: 12, SBT: 24 },
		// Contraintes admissibles : { matériau: { fictitious?: bool, points: [{ tempC, s }] } } (S en MPa, points triés par température).
		// VIDE PAR DÉFAUT : sans valeur (ou hors plage de température), le t_min n'est pas calculable. Interpolation linéaire, jamais d'extrapolation.
		allowableStress: {},
		// Famille de matériau (pour le plancher de vitesse de corrosion). Matériau inconnu → acier carbone (conservateur).
		materialFamilies: {},
		// Plancher de vitesse de corrosion (mm/an) par famille de matériau.
		corrosionFloors: { carbon: 0.05, cra: 0.01 },
		// Formule de t_min par classe : 'pipe' (ASME B31.3, tuyauterie droite) ou 'vessel' (virole cylindrique, rayon extérieur).
		classFormula: { PIPE: "pipe", RISER: "pipe", PV: "vessel", HX: "vessel" },
		pipe: { y: 0.4, e: 1 },
		vessel: { e: 1 },
		// Épaisseur minimale structurelle (mm), indépendante de la pression. Tuyauteries : par plage de diamètre extérieur
		// (première ligne dont maxOdMm ≥ D ; maxOdMm null = au-delà). Appareils : valeur unique.
		structuralMin: { pipe: [{ maxOdMm: 114.3, min: 2.0 }, { maxOdMm: null, min: 2.8 }], vessel: 2.5 },
		// Seuils de durée de vie résiduelle (ans) pour PoF 1,2,3,4 (en dessous du dernier : PoF 5).
		pofThresholds: [20, 10, 5, 2],
		// PoF par défaut d'un actif jamais inspecté (ou sans donnée exploitable) : `high` si CoF ≥ cofFrom, sinon `low`.
		defaultPof: { cofFrom: 4, high: 4, low: 3 },
		// Correspondance grade (1..4) → PoF, pour les équipements suivis par leur état.
		gradeToPof: [1, 2, 3, 5],
		minShortTermYears: 0.25,
		minLongTermYears: 0.5,
		// CoF d'un actif sans note de conséquence et sans fluide connu (conservateur) ; l'actif reste signalé incomplet.
		defaultConsequence: 5,
		// Délais cibles par priorité (jours).
		priorityDays: { P1: 7, P2: 30, P3: 90, P4: 365 },
		// Priorité suggérée à la saisie d'une inspection (proposition, jamais automatique).
		anomalySuggestion: { belowTmin: "P1", rlUnder2: "P1", rlUnder5: "P3", grade4: "P2", grade3: "P3" },
		// Alerte avant expiration d'une réparation temporaire (jours).
		repairAlertDays: 90,
		endOfLifeRlYears: 10,
		dueSoonDays: 90,
		// Disciplines proposées sur les actifs (liste configurable).
		disciplines: [...DISCIPLINES],
	};
}

/** Contrôle de cohérence de la configuration ; retourne la liste des problèmes (vide = OK). */
function validateConfig(c) {
	const err = [];
	const num = (v) => typeof v === "number" && Number.isFinite(v);
	const m = c.matrix;
	if (!Array.isArray(m) || m.length !== 5 || m.some((r) => !Array.isArray(r) || r.length !== 5 || r.some((v) => !LEVELS.includes(v)))) {
		err.push("matrix : 5×5 de L/M/MH/H attendu");
	}
	for (const l of LEVELS) if (!(c.intervals?.[l] >= 0)) err.push(`intervals.${l} : nombre de mois ≥ 0 attendu`);
	const t = c.pofThresholds;
	if (!Array.isArray(t) || t.length !== 4 || t.some((v, i) => !(v > 0) || (i && v >= t[i - 1]))) err.push("pofThresholds : 4 valeurs strictement décroissantes");
	for (const p of ["P1", "P2", "P3", "P4"]) if (!(c.priorityDays?.[p] > 0)) err.push(`priorityDays.${p} : valeur > 0 attendue`);

	const st = c.allowableStress;
	if (!st || typeof st !== "object" || Array.isArray(st)) err.push("allowableStress : { matériau: { points: [{ tempC, s }] } } attendu");
	else for (const [mat, e] of Object.entries(st)) {
		const pts = e?.points;
		if (!Array.isArray(pts) || !pts.length) { err.push(`allowableStress.${mat} : au moins un point { tempC, s }`); continue; }
		if (pts.some((p) => !num(p.tempC) || !(num(p.s) && p.s > 0))) err.push(`allowableStress.${mat} : tempC numérique et s > 0 (MPa) attendus`);
		else if (pts.some((p, i) => i && p.tempC <= pts[i - 1].tempC)) err.push(`allowableStress.${mat} : températures strictement croissantes attendues`);
	}
	for (const [mat, f] of Object.entries(c.materialFamilies || {})) if (!FAMILIES.includes(f)) err.push(`materialFamilies.${mat} : famille ${FAMILIES.join(" / ")}`);
	for (const f of FAMILIES) if (!(c.corrosionFloors?.[f] > 0)) err.push(`corrosionFloors.${f} : valeur > 0 attendue`);
	const g = c.gradeToPof;
	if (!Array.isArray(g) || g.length !== 4 || g.some((v, i) => !Number.isInteger(v) || v < 1 || v > 5 || (i && v < g[i - 1]))) err.push("gradeToPof : 4 entiers 1–5 croissants (grade 1 à 4)");
	const d = c.defaultPof;
	if (!d || !Number.isInteger(d.cofFrom) || d.cofFrom < 1 || d.cofFrom > 5 || ![d.high, d.low].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) err.push("defaultPof : { cofFrom, high, low } entiers 1–5");
	if (!(Number.isInteger(c.defaultConsequence) && c.defaultConsequence >= 1 && c.defaultConsequence <= 5)) err.push("defaultConsequence : entier 1–5");
	const sm = c.structuralMin;
	if (!sm || !(sm.vessel > 0) || !Array.isArray(sm.pipe) || !sm.pipe.length) err.push("structuralMin : { pipe: [{ maxOdMm, min }], vessel } attendu");
	else {
		const bad = sm.pipe.some((r, i) => !(r.min > 0) || (r.maxOdMm !== null && !(r.maxOdMm > 0)) || (r.maxOdMm === null && i !== sm.pipe.length - 1) || (i && r.maxOdMm !== null && r.maxOdMm <= (sm.pipe[i - 1].maxOdMm ?? 0)));
		if (bad) err.push("structuralMin.pipe : plages de diamètre croissantes, la dernière sans limite (maxOdMm null), min > 0");
	}
	if (!Array.isArray(c.disciplines) || !c.disciplines.length || c.disciplines.some((x) => typeof x !== "string" || !x.trim())) err.push("disciplines : liste de noms non vide");
	return err;
}

module.exports = { LEVELS, DISCIPLINES, FAMILIES, DEFAULT_CLASS_DISCIPLINE, defaultMatrix, defaultConfig, validateConfig };
