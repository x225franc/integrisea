// Configuration applicative : valeurs par défaut du moteur + surcharges enregistrées en base (table config_settings).
const db = require("../config/db");
const engine = require("../../packages/engine");

// Notes de conséquence par défaut selon le fluide [S, E, P] — valeurs de départ configurables, à valider.
const FLUID_CRITICALITY = {
	"Multiphase HC": [5, 4, 5], "Crude oil": [4, 4, 4], "HC gas": [5, 3, 4], "Fuel gas": [4, 2, 3], "Produced water": [2, 3, 2],
	Seawater: [1, 1, 3], Diesel: [3, 3, 2], Chemicals: [3, 3, 2], Structural: [5, 2, 5], Instrument: [3, 2, 3], Electrical: [4, 1, 2],
};

const CONSEQUENCE_SCALES = {
	s: {
		en: ["No injury", "First aid / minor injury", "Lost-time injury", "Single fatality or major injury", "Multiple fatalities"],
		fr: ["Aucune blessure", "Premiers soins / blessure légère", "Accident avec arrêt de travail", "Un décès ou blessure grave", "Plusieurs décès"],
	},
	e: {
		en: ["No impact", "Minor local release, contained", "Reportable release, short-term impact", "Major release, significant impact", "Massive release, long-term damage"],
		fr: ["Aucun impact", "Petit rejet local, contenu", "Rejet à déclarer, impact à court terme", "Rejet majeur, impact significatif", "Rejet massif, dommages durables"],
	},
	p: {
		en: ["No loss", "< 1 day deferment", "1–7 days deferment", "1–4 weeks deferment", "> 1 month / field shutdown"],
		fr: ["Aucune perte", "< 1 jour de production différée", "1 à 7 jours", "1 à 4 semaines", "> 1 mois / arrêt du champ"],
	},
};

// Valeurs de démonstration UNIQUEMENT (FICTIVES, non validées), appliquées sur toute la plage −29 °C à 200 °C. La table est vide en exploitation.
const demoRange = (s) => ({ fictitious: true, points: [{ tempC: -29, s }, { tempC: 200, s }] });
const DEMO_ALLOWABLE_STRESS = { CS: demoRange(138), "22Cr Duplex": demoRange(207), "316L": demoRange(115), "CuNi 90/10": demoRange(69) };
// Familles de matériaux de la démonstration (plancher de vitesse de corrosion) : acier carbone par défaut, alliages résistants pour les autres.
const DEMO_MATERIAL_FAMILIES = { CS: "carbon", "22Cr Duplex": "cra", "316L": "cra", "CuNi 90/10": "cra" };

const ENGINE_KEYS = [
	"matrix", "intervals", "classMaxInterval", "allowableStress", "materialFamilies", "corrosionFloors", "classFormula", "pipe", "vessel", "structuralMin", "pofThresholds",
	"defaultPof", "gradeToPof", "defaultConsequence", "minShortTermYears", "minLongTermYears", "priorityDays", "anomalySuggestion", "repairAlertDays", "endOfLifeRlYears", "dueSoonDays", "disciplines",
];
const OTHER_KEYS = ["fluidCriticality", "consequenceScales"];
const ALL_KEYS = [...ENGINE_KEYS, ...OTHER_KEYS];

// Familles de matériaux : saisies avec la table des contraintes ; coefficients ASME (Y, E) : portés par les formules par classe.
const DERIVED_FROM = { materialFamilies: "allowableStress", pipe: "classFormula", vessel: "classFormula" };

let cache = null;
const invalidate = () => { cache = null; };

async function loadSettings(conn = db) {
	if (cache && conn === db) return cache;
	const [rows] = await conn.query("SELECT setting_key, value_json FROM config_settings");
	const over = Object.fromEntries(rows.map((r) => [r.setting_key, typeof r.value_json === "string" ? JSON.parse(r.value_json) : r.value_json]));
	const engineConfig = engine.defaultConfig();
	for (const k of ENGINE_KEYS) if (over[k] !== undefined) engineConfig[k] = over[k];
	const s = {
		engine: engineConfig,
		fluidCriticality: over.fluidCriticality ?? FLUID_CRITICALITY,
		consequenceScales: over.consequenceScales ?? CONSEQUENCE_SCALES,
	};
	if (conn === db) cache = s;
	return s;
}

/**
 * Date de validation de chaque paramètre par un administrateur (clé → ISO | null). Tant qu'un paramètre n'a pas été validé
 * (ou qu'il a été modifié depuis), il est PROVISOIRE : valeur de départ fondée sur les bonnes pratiques, à arbitrer.
 * Les gabarits d'inspection portent leur propre validation (clé « template:ID »).
 */
async function loadValidation(conn = db) {
	const [rows] = await conn.query("SELECT setting_key, validated_at FROM config_settings");
	const [tpls] = await conn.query("SELECT id, validated_at FROM inspection_templates WHERE is_active = 1");
	const out = {};
	for (const k of ALL_KEYS) out[k] = null;
	for (const r of rows) if (r.validated_at) out[r.setting_key] = new Date(r.validated_at).toISOString();
	for (const t of tpls) out[`template:${t.id}`] = t.validated_at ? new Date(t.validated_at).toISOString() : null;
	// Paramètres sans carte propre dans l'interface : leur statut suit celui de la carte qui les porte.
	for (const [derived, parent] of Object.entries(DERIVED_FROM)) out[derived] = out[parent];
	return out;
}

/** Valeurs par défaut + surcharges, sous forme d'objet clé → valeur (pour l'écran de configuration). `_meta` : état de validation. */
async function settingsForUi() {
	const s = await loadSettings();
	const out = {};
	for (const k of ENGINE_KEYS) out[k] = s.engine[k];
	out.fluidCriticality = s.fluidCriticality;
	out.consequenceScales = s.consequenceScales;
	const validated = await loadValidation();
	out._meta = { validated, provisional: Object.keys(validated).filter((k) => !validated[k] && !(k in DERIVED_FROM)) };
	return out;
}

/** Valide puis enregistre une clé. Retourne la liste d'erreurs (vide si OK). */
async function validateSetting(key, value) {
	if (!ALL_KEYS.includes(key)) return [`Clé inconnue : ${key}`];
	const probe = engine.defaultConfig();
	if (ENGINE_KEYS.includes(key)) probe[key] = value;
	const errs = ENGINE_KEYS.includes(key) ? engine.validateConfig(probe) : [];
	const num = (v) => typeof v === "number" && Number.isFinite(v);
	const isObjOf = (o, f) => o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every(f);
	if (key === "classMaxInterval" && !isObjOf(value, (v) => num(v) && v >= 0)) errs.push("classMaxInterval : { classe: mois ≥ 0 }");
	if (key === "classFormula" && !isObjOf(value, (v) => v === "pipe" || v === "vessel")) errs.push("classFormula : valeurs 'pipe' ou 'vessel'");
	if (key === "fluidCriticality" && !isObjOf(value, (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 5))) errs.push("fluidCriticality : { fluide: [S,E,P] entiers 1–5 }");
	if (key === "consequenceScales" && !["s", "e", "p"].every((a) => ["fr", "en"].every((l) => Array.isArray(value?.[a]?.[l]) && value[a][l].length === 5))) errs.push("consequenceScales : { s|e|p: { fr:[5], en:[5] } }");
	if (["pipe", "vessel"].includes(key) && !(value && num(value.e) && value.e > 0 && (key === "vessel" || num(value.y)))) errs.push(`${key} : coefficients numériques attendus`);
	// allowableStress, materialFamilies, corrosionFloors, gradeToPof, defaultPof, defaultConsequence, structuralMin, disciplines : validateConfig (moteur).
	if (["repairAlertDays", "endOfLifeRlYears", "dueSoonDays", "minShortTermYears", "minLongTermYears"].includes(key) && !(num(value) && value > 0)) errs.push(`${key} : nombre > 0`);
	if (key === "anomalySuggestion" && !["belowTmin", "rlUnder2", "rlUnder5", "grade4", "grade3"].every((k) => ["P1", "P2", "P3", "P4"].includes(value?.[k]))) errs.push("anomalySuggestion : priorités P1–P4");
	return errs;
}

module.exports = { loadSettings, loadValidation, settingsForUi, validateSetting, invalidate, ENGINE_KEYS, ALL_KEYS, FLUID_CRITICALITY, CONSEQUENCE_SCALES, DEMO_ALLOWABLE_STRESS, DEMO_MATERIAL_FAMILIES };
