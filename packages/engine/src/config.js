// Configuration par défaut du moteur. Tout est modifiable par l'administrateur (étape 6) ;
// ces valeurs sont des valeurs de départ, à valider par des ingénieurs intégrité qualifiés.

const LEVELS = ["L", "M", "MH", "H"];

/** Matrice 5×5 : ligne = PoF 1..5, colonne = CoF 1..5. Défaut : somme PoF+CoF. */
function defaultMatrix() {
	return Array.from({ length: 5 }, (_, p) =>
		Array.from({ length: 5 }, (_, c) => {
			const s = p + c + 2;
			return s <= 4 ? "L" : s <= 6 ? "M" : s <= 8 ? "MH" : "H";
		}));
}

function defaultConfig() {
	return {
		matrix: defaultMatrix(),
		// Intervalle maximal (mois) par niveau de risque.
		intervals: { L: 96, M: 60, MH: 36, H: 12 },
		// Intervalle maximal (mois) par classe d'équipement.
		classMaxInterval: { EX: 36, PSV: 36, HOSE: 12, SBT: 24 },
		// Contraintes admissibles (MPa) par matériau. VIDE PAR DÉFAUT : sans valeur, le t_min n'est pas calculable.
		allowableStress: {},
		// Formule de t_min par classe : 'pipe' (ASME B31.3, tuyauterie droite) ou 'vessel' (virole cylindrique).
		classFormula: { PIPE: "pipe", RISER: "pipe", PV: "vessel", HX: "vessel" },
		pipe: { y: 0.4, e: 1 },
		vessel: { e: 1 },
		// Épaisseur minimale structurelle (mm), indépendante de la pression.
		structuralMin: { pipeSmall: 2.0, pipeLarge: 2.8, pipeSmallMaxOdMm: 114.3, vessel: 2.5 },
		// Seuils de durée de vie résiduelle (ans) pour PoF 1,2,3,4 (en dessous du dernier : PoF 5).
		pofThresholds: [20, 10, 5, 2],
		defaultPofNoData: 3,
		minCorrosionRate: 0.01, // mm/an
		minShortTermYears: 0.25,
		minLongTermYears: 0.5,
		defaultConsequence: 3,
		// Délais cibles par priorité (jours).
		priorityDays: { P1: 7, P2: 30, P3: 90, P4: 365 },
		// Priorité suggérée à la saisie d'une inspection (proposition, jamais automatique).
		anomalySuggestion: { belowTmin: "P1", rlUnder2: "P2", rlUnder5: "P3", grade4: "P2", grade3: "P3" },
		// Alerte avant expiration d'une réparation temporaire (jours).
		repairAlertDays: 30,
		endOfLifeRlYears: 10,
		dueSoonDays: 90,
	};
}

/** Contrôle de cohérence de la configuration ; retourne la liste des problèmes (vide = OK). */
function validateConfig(c) {
	const err = [];
	const m = c.matrix;
	if (!Array.isArray(m) || m.length !== 5 || m.some((r) => !Array.isArray(r) || r.length !== 5 || r.some((v) => !LEVELS.includes(v)))) {
		err.push("matrix : 5×5 de L/M/MH/H attendu");
	}
	for (const l of LEVELS) if (!(c.intervals?.[l] >= 0)) err.push(`intervals.${l} : nombre de mois ≥ 0 attendu`);
	const t = c.pofThresholds;
	if (!Array.isArray(t) || t.length !== 4 || t.some((v, i) => !(v > 0) || (i && v >= t[i - 1]))) err.push("pofThresholds : 4 valeurs strictement décroissantes");
	for (const [k, v] of Object.entries(c.allowableStress || {})) if (!(v > 0)) err.push(`allowableStress.${k} : valeur > 0 attendue`);
	for (const p of ["P1", "P2", "P3", "P4"]) if (!(c.priorityDays?.[p] > 0)) err.push(`priorityDays.${p} : valeur > 0 attendue`);
	return err;
}

module.exports = { LEVELS, defaultMatrix, defaultConfig, validateConfig };
