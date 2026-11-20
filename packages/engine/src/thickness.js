const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Contrainte admissible S (MPa) du matériau à la température de calcul : interpolation linéaire entre les deux points encadrants.
 * Jamais d'extrapolation : hors de la plage renseignée, ou matériau absent, le résultat est « non disponible ».
 * Retourne { ok, s, interpolated, reason?, range? }.
 */
function allowableStressAt(material, tempC, config) {
	const pts = config.allowableStress?.[material]?.points;
	if (!pts || !pts.length) return { ok: false, reason: "material" };
	if (!Number.isFinite(tempC)) return { ok: false, reason: "temperature" };
	const lo = pts[0].tempC, hi = pts[pts.length - 1].tempC;
	if (tempC < lo || tempC > hi) return { ok: false, reason: "range", range: [lo, hi] };
	for (let i = 0; i < pts.length; i++) {
		if (pts[i].tempC === tempC) return { ok: true, s: pts[i].s, interpolated: false };
		if (i && tempC < pts[i].tempC) {
			const a = pts[i - 1], b = pts[i];
			return { ok: true, s: a.s + ((b.s - a.s) * (tempC - a.tempC)) / (b.tempC - a.tempC), interpolated: true, from: [a, b] };
		}
	}
	return { ok: false, reason: "range", range: [lo, hi] };
}

/** Plancher structurel (mm) : tuyauterie par plage de diamètre extérieur, appareils valeur unique. */
function structuralMinimum(formula, odMm, config) {
	const sm = config.structuralMin;
	if (formula !== "pipe") return sm.vessel;
	const row = sm.pipe.find((r) => r.maxOdMm === null || odMm <= r.maxOdMm) ?? sm.pipe[sm.pipe.length - 1];
	return row.min;
}

/**
 * Épaisseur minimale requise t_min.
 *  - 'pipe'   : ASME B31.3 tuyauterie droite            t = P·D / (2·(S·E + P·Y))   (Y = 0,4 ; E = 1)
 *  - 'vessel' : virole cylindrique, rayon EXTÉRIEUR      t = P·Ro / (S·E + 0,4·P)    (Ro = D/2 ; ASME VIII-1, appendice 1-1)
 * puis plancher structurel. Unités : P en barg (converti en MPa), D et t en mm, S en MPa (à la température de calcul).
 * La formule au rayon extérieur ne dépend pas de l'épaisseur : elle reste valable quand la paroi s'amincit.
 * Périmètre : viroles cylindriques uniquement (fonds et éléments coniques hors périmètre).
 * Tolérance de fabrication et surépaisseur de corrosion NON intégrées (choix volontaire).
 *
 * Retourne { ok, tmin, tCalc, tStruct, formula, missing[], lines[] }. Si une donnée manque, ok = false et tmin = null :
 * aucune valeur par défaut n'est inventée (table des contraintes admissibles vide tant qu'elle n'est pas renseignée).
 */
function computeTmin(asset, config) {
	const formula = config.classFormula?.[asset.classCode];
	const missing = [];
	if (!formula) missing.push("formula");
	if (!(asset.odMm > 0)) missing.push("odMm");
	if (!(asset.nominalThicknessMm > 0)) missing.push("nominalThicknessMm");
	if (!(asset.designPressureBarg >= 0) || asset.designPressureBarg === null || asset.designPressureBarg === undefined) missing.push("designPressureBarg");
	const temp = asset.designTempC === null || asset.designTempC === undefined || asset.designTempC === "" ? NaN : Number(asset.designTempC);
	const st = allowableStressAt(asset.material, temp, config);
	if (!st.ok) {
		if (st.reason === "temperature") missing.push("designTempC");
		else if (st.reason === "range") missing.push(`allowableStressRange:${asset.material}`);
		else missing.push(`allowableStress:${asset.material ?? "?"}`);
	}
	if (missing.length) {
		return { ok: false, tmin: null, formula: formula ?? null, missing, lines: [{ code: "tmin_missing", params: { missing, range: st.range ?? null, tempC: Number.isFinite(temp) ? temp : null, material: asset.material ?? null } }] };
	}

	const S = st.s;
	const P = asset.designPressureBarg * 0.1; // barg → MPa
	const D = asset.odMm;
	let tCalc, params;
	if (formula === "pipe") {
		const { y, e } = config.pipe;
		tCalc = (P * D) / (2 * (S * e + P * y));
		params = { formula, P, D, S, E: e, Y: y };
	} else {
		const { e } = config.vessel;
		const Ro = D / 2;
		tCalc = (P * Ro) / (S * e + 0.4 * P);
		params = { formula, P, Ro, S, E: e };
	}
	const tStruct = structuralMinimum(formula, D, config);
	const tmin = round2(Math.max(tCalc, tStruct));
	return {
		ok: true, tmin, tCalc: round2(tCalc), tStruct, formula, missing: [], stress: S,
		lines: [
			...(st.interpolated ? [{ code: "stress_interpolated", params: { material: asset.material, tempC: temp, s: S, from: st.from } }] : []),
			{ code: "tmin", params: { ...params, tCalc: round2(tCalc), tStruct, tmin, governs: tCalc >= tStruct ? "pressure" : "structural" } },
			{ code: "tmin_scope", params: { formula } },
		],
	};
}

module.exports = { computeTmin, allowableStressAt, structuralMinimum, round2 };
