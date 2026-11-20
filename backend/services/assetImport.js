// Colonnes, validation et conversion des lignes d'import/export du registre des actifs (partie pure, testée).
const { z, optStr, optNum, optInt } = require("../utils/validate");

const COLUMNS = [
	"tag", "system", "class", "description", "fluid", "material",
	"design_pressure_barg", "design_temp_c", "od_mm", "nominal_thickness_mm",
	"install_year", "degradation_mechanisms", "crit_s", "crit_e", "crit_p", "discipline",
];

const crit = optInt(1, 5);

/** Champs d'un actif (communs à l'API JSON et à l'import). */
const assetFields = {
	description: z.string().trim().min(1, "Description requise").max(255),
	fluid: optStr(80),
	material: optStr(80),
	design_pressure_barg: optNum(0, 10000),
	design_temp_c: optNum(-273, 2000),
	od_mm: optNum(0, 20000),
	nominal_thickness_mm: optNum(0, 1000),
	install_year: optInt(1900, 2100),
	crit_s: crit,
	crit_e: crit,
	crit_p: crit,
};

const mechanisms = z.preprocess(
	(v) => (typeof v === "string" ? v.split("|").map((s) => s.trim()).filter(Boolean) : v ?? []),
	z.array(z.string().trim().min(1).max(80)).max(30),
);

const importRowSchema = z.object({
	tag: z.string().trim().min(1, "Tag requis").max(60),
	system: z.string().trim().min(1, "Système requis"),
	class: z.string().trim().min(1, "Classe requise"),
	degradation_mechanisms: mechanisms,
	discipline: optStr(40), // vide = discipline par défaut de la classe
	...assetFields,
});

/**
 * Convertit des lignes brutes (objets clé→valeur) en actifs validés.
 * lookups = { systemsByCode: Map(code → {id, facility_id}), classCodes: Set }
 * Retourne { rows: [{line, tag, data}], errors: [{line, tag, message}] }. `line` = numéro de ligne dans le fichier.
 */
function parseImportRows(raw, lookups) {
	const rows = [];
	const errors = [];
	const seen = new Map();
	raw.forEach((r, i) => {
		const line = i + 2; // ligne 1 = en-têtes
		const parsed = importRowSchema.safeParse(r);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) errors.push({ line, tag: r.tag || null, message: `${issue.path.join(".")} : ${issue.message}` });
			return;
		}
		const d = parsed.data;
		const sys = lookups.systemsByCode.get(d.system.toUpperCase()) || lookups.systemsByCode.get(d.system);
		const cls = d.class.toUpperCase();
		const rowErrors = [];
		if (!sys) rowErrors.push(`Système inconnu : ${d.system}`);
		if (!lookups.classCodes.has(cls)) rowErrors.push(`Classe inconnue : ${d.class}`);
		if (d.discipline && lookups.disciplines && !lookups.disciplines.has(d.discipline)) rowErrors.push(`Discipline inconnue : ${d.discipline}`);
		const key = d.tag.toUpperCase();
		if (seen.has(key)) rowErrors.push(`Tag en double dans le fichier (ligne ${seen.get(key)})`);
		else seen.set(key, line);
		if (rowErrors.length) {
			rowErrors.forEach((message) => errors.push({ line, tag: d.tag, message }));
			return;
		}
		const { system, class: _c, ...rest } = d;
		rows.push({ line, tag: d.tag, facilityId: sys.facility_id, data: { ...rest, system_id: sys.id, class_code: cls } });
	});
	return { rows, errors };
}

/** Ligne d'export : objet SQL → objet aux colonnes COLUMNS. */
function toExportRow(a) {
	const mech = typeof a.degradation_mechanisms === "string" ? JSON.parse(a.degradation_mechanisms) : a.degradation_mechanisms;
	return {
		tag: a.tag, system: a.system_code, class: a.class_code, description: a.description,
		fluid: a.fluid, material: a.material, design_pressure_barg: a.design_pressure_barg,
		design_temp_c: a.design_temp_c, od_mm: a.od_mm, nominal_thickness_mm: a.nominal_thickness_mm,
		install_year: a.install_year, degradation_mechanisms: (mech || []).join("|"),
		crit_s: a.crit_s, crit_e: a.crit_e, crit_p: a.crit_p, discipline: a.discipline,
	};
}

module.exports = { COLUMNS, assetFields, mechanisms, parseImportRows, toExportRow };
