// Import / export de la table des contraintes admissibles (matériau × température) depuis / vers CSV ou Excel.
// Partie pure (testée) : conversion lignes ↔ table. Colonnes : material, temp_c, s_mpa, family (facultative : carbon | cra).
const COLUMNS = ["material", "temp_c", "s_mpa", "family"];
const FAMILIES = ["carbon", "cra"];

/** Nombre saisi dans Excel/CSV, virgule décimale française acceptée. null si illisible. */
function toNumber(v) {
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	const s = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
	if (s === "") return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/**
 * rows : objets clé → valeur (clés en minuscules, voir tabular.readTable).
 * Retourne { allowableStress, materialFamilies, errors[{line, message}], materials, points }.
 * Aucune valeur n'est complétée ni extrapolée : ce qui n'est pas dans le fichier n'existe pas dans la table.
 */
function parseStressRows(rows) {
	const errors = [];
	const byMat = new Map();
	const families = {};
	rows.forEach((r, i) => {
		const line = i + 2; // ligne 1 = en-têtes
		const material = String(r.material ?? "").trim();
		const t = toNumber(r.temp_c);
		const s = toNumber(r.s_mpa);
		const fam = String(r.family ?? "").trim().toLowerCase();
		if (!material) return errors.push({ line, message: "material : requis" });
		if (material.length > 80) return errors.push({ line, message: "material : 80 caractères maximum" });
		if (t === null) return errors.push({ line, message: `temp_c : nombre attendu (« ${r.temp_c ?? ""} »)` });
		if (s === null || !(s > 0)) return errors.push({ line, message: `s_mpa : nombre > 0 attendu (« ${r.s_mpa ?? ""} »)` });
		if (fam && !FAMILIES.includes(fam)) return errors.push({ line, message: `family : ${FAMILIES.join(" ou ")} attendu` });
		const list = byMat.get(material) || byMat.set(material, []).get(material);
		if (list.some((p) => p.tempC === t)) return errors.push({ line, message: `${material} : température ${t} °C en double` });
		list.push({ tempC: t, s });
		if (fam) {
			if (families[material] && families[material] !== fam) errors.push({ line, message: `${material} : familles contradictoires` });
			families[material] = fam;
		}
	});
	const allowableStress = {};
	for (const [m, pts] of byMat) allowableStress[m] = { points: pts.sort((a, b) => a.tempC - b.tempC) };
	return { allowableStress, materialFamilies: families, errors, materials: byMat.size, points: [...byMat.values()].reduce((n, p) => n + p.length, 0) };
}

/** Table → lignes d'export (modèle d'import). */
function tableToRows(allowableStress, materialFamilies = {}) {
	const out = [];
	for (const [material, e] of Object.entries(allowableStress || {})) {
		for (const p of e.points) out.push({ material, temp_c: p.tempC, s_mpa: p.s, family: materialFamilies[material] ?? "" });
	}
	return out;
}

module.exports = { COLUMNS, FAMILIES, parseStressRows, tableToRows, toNumber };
