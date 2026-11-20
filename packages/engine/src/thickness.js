const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Épaisseur minimale requise t_min.
 *  - 'pipe'   : ASME B31.3 tuyauterie droite   t = P·D / (2·(S·E + P·Y))   (Y = 0,4 ; E = 1)
 *  - 'vessel' : virole cylindrique             t = P·R / (S·E − 0,6·P)     (R = D/2 − t_nom)
 * puis plancher structurel. Unités : P en barg (converti en MPa), D et t en mm, S en MPa.
 *
 * Retourne { ok, tmin, tCalc, tStruct, formula, missing[], lines[] }. Si une donnée manque, ok = false et tmin = null :
 * aucune valeur par défaut n'est inventée (la table des contraintes admissibles est vide tant qu'elle n'est pas renseignée).
 */
function computeTmin(asset, config) {
	const formula = config.classFormula?.[asset.classCode];
	const missing = [];
	if (!formula) missing.push("formula");
	if (!(asset.odMm > 0)) missing.push("odMm");
	if (!(asset.nominalThicknessMm > 0)) missing.push("nominalThicknessMm");
	if (!(asset.designPressureBarg >= 0) || asset.designPressureBarg === null || asset.designPressureBarg === undefined) missing.push("designPressureBarg");
	const S = config.allowableStress?.[asset.material];
	if (!(S > 0)) missing.push(`allowableStress:${asset.material ?? "?"}`);
	if (missing.length) return { ok: false, tmin: null, formula: formula ?? null, missing, lines: [{ code: "tmin_missing", params: { missing } }] };

	const P = asset.designPressureBarg * 0.1; // barg → MPa
	const D = asset.odMm;
	let tCalc, params;
	if (formula === "pipe") {
		const { y, e } = config.pipe;
		tCalc = (P * D) / (2 * (S * e + P * y));
		params = { formula, P, D, S, E: e, Y: y };
	} else {
		const { e } = config.vessel;
		const R = D / 2 - asset.nominalThicknessMm;
		if (!(R > 0) || !(S * e - 0.6 * P > 0)) {
			return { ok: false, tmin: null, formula, missing: ["geometry"], lines: [{ code: "tmin_invalid_geometry", params: { R, S, P } }] };
		}
		tCalc = (P * R) / (S * e - 0.6 * P);
		params = { formula, P, R, S, E: e };
	}
	const sm = config.structuralMin;
	const tStruct = formula === "pipe" ? (D <= sm.pipeSmallMaxOdMm ? sm.pipeSmall : sm.pipeLarge) : sm.vessel;
	const tmin = round2(Math.max(tCalc, tStruct));
	return {
		ok: true, tmin, tCalc: round2(tCalc), tStruct, formula, missing: [],
		lines: [{ code: "tmin", params: { ...params, tCalc: round2(tCalc), tStruct, tmin, governs: tCalc >= tStruct ? "pressure" : "structural" } }],
	};
}

module.exports = { computeTmin, round2 };
