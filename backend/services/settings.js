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

// Valeurs de démonstration UNIQUEMENT (fictives, non validées). La table est vide en exploitation.
const DEMO_ALLOWABLE_STRESS = { CS: 138, "22Cr Duplex": 207, "316L": 115, "CuNi 90/10": 69 };

const ENGINE_KEYS = [
	"matrix", "intervals", "classMaxInterval", "allowableStress", "classFormula", "pipe", "vessel", "structuralMin", "pofThresholds",
	"defaultPofNoData", "minCorrosionRate", "priorityDays", "anomalySuggestion", "repairAlertDays", "endOfLifeRlYears", "dueSoonDays",
];
const OTHER_KEYS = ["fluidCriticality", "consequenceScales"];
const ALL_KEYS = [...ENGINE_KEYS, ...OTHER_KEYS];

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

/** Valeurs par défaut + surcharges, sous forme d'objet clé → valeur (pour l'écran de configuration). */
async function settingsForUi() {
	const s = await loadSettings();
	const out = {};
	for (const k of ENGINE_KEYS) out[k] = s.engine[k];
	out.fluidCriticality = s.fluidCriticality;
	out.consequenceScales = s.consequenceScales;
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
	if (key === "allowableStress" && !isObjOf(value, (v) => num(v) && v > 0)) errs.push("allowableStress : { matériau: contrainte MPa > 0 }");
	if (key === "classMaxInterval" && !isObjOf(value, (v) => num(v) && v >= 0)) errs.push("classMaxInterval : { classe: mois ≥ 0 }");
	if (key === "classFormula" && !isObjOf(value, (v) => v === "pipe" || v === "vessel")) errs.push("classFormula : valeurs 'pipe' ou 'vessel'");
	if (key === "fluidCriticality" && !isObjOf(value, (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 5))) errs.push("fluidCriticality : { fluide: [S,E,P] entiers 1–5 }");
	if (key === "consequenceScales" && !["s", "e", "p"].every((a) => ["fr", "en"].every((l) => Array.isArray(value?.[a]?.[l]) && value[a][l].length === 5))) errs.push("consequenceScales : { s|e|p: { fr:[5], en:[5] } }");
	if (["pipe", "vessel"].includes(key) && !(value && num(value.e) && value.e > 0 && (key === "vessel" || num(value.y)))) errs.push(`${key} : coefficients numériques attendus`);
	if (key === "structuralMin" && !["pipeSmall", "pipeLarge", "pipeSmallMaxOdMm", "vessel"].every((k) => num(value?.[k]) && value[k] > 0)) errs.push("structuralMin : 4 valeurs > 0");
	if (["defaultPofNoData"].includes(key) && !(Number.isInteger(value) && value >= 1 && value <= 5)) errs.push("defaultPofNoData : entier 1–5");
	if (["minCorrosionRate", "repairAlertDays", "endOfLifeRlYears", "dueSoonDays"].includes(key) && !(num(value) && value > 0)) errs.push(`${key} : nombre > 0`);
	if (key === "anomalySuggestion" && !["belowTmin", "rlUnder2", "rlUnder5", "grade4", "grade3"].every((k) => ["P1", "P2", "P3", "P4"].includes(value?.[k]))) errs.push("anomalySuggestion : priorités P1–P4");
	return errs;
}

module.exports = { loadSettings, settingsForUi, validateSetting, invalidate, ENGINE_KEYS, ALL_KEYS, FLUID_CRITICALITY, CONSEQUENCE_SCALES, DEMO_ALLOWABLE_STRESS };
