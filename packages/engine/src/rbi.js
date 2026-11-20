// Évaluation RBI semi-quantitative d'un actif (cahier des charges §4.6). Fonction PURE : mêmes entrées → mêmes sorties,
// aucune E/S, aucune lecture de l'horloge (la date du jour est un paramètre). Chaque décision produit une ligne
// explicative { code, params } que l'interface traduit : le calcul est reproductible et expliqué ligne par ligne.
//
// ⚠️ Ce n'est PAS un moteur API 580/581. Il est isolé derrière evaluateAsset() pour pouvoir être remplacé
// plus tard par un moteur validé et sous licence sans toucher au reste de l'application.
const { yearsBetween, daysBetween, addMonths } = require("./dates");
const { computeTmin, round2 } = require("./thickness");
const { computeCorrosion } = require("./corrosion");
const { governingThickness } = require("./grading");

const clampPof = (p) => Math.min(5, Math.max(1, p));

function pofFromRemainingLife(rl, thresholds) {
	for (let i = 0; i < thresholds.length; i++) if (rl >= thresholds[i]) return i + 1;
	return 5;
}

/** Criticité à partir des notes de conséquence : A si une note ≥ 4, B si le maximum vaut 3, sinon C. SCE si S ≥ 4. */
function criticality(crit, config) {
	const vals = [crit?.s, crit?.e, crit?.p].filter((v) => Number.isFinite(v));
	const missing = vals.length === 0;
	const cof = missing ? config.defaultConsequence : Math.max(...vals);
	return { cof, class: cof >= 4 ? "A" : cof === 3 ? "B" : "C", sce: (crit?.s ?? 0) >= 4, missing };
}

/**
 * input = {
 *   asset: { tag, classCode, tracking:'thickness'|'condition', material, designPressureBarg, odMm, nominalThicknessMm, installYear, crit:{s,e,p} },
 *   inspections: [{ date, grade|null, readings:[{t}|number]|null }],
 *   openAnomalies: [{ priority }]
 * }
 */
function evaluateAsset(input, config, todayIso) {
	const { asset } = input;
	const lines = [];
	const incomplete = [];
	const inspections = [...(input.inspections || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const crit = criticality(asset.crit, config);
	if (crit.missing) { incomplete.push("consequence"); lines.push({ code: "consequence_default", params: { cof: crit.cof } }); }
	lines.push({ code: "cof", params: { s: asset.crit?.s ?? null, e: asset.crit?.e ?? null, p: asset.crit?.p ?? null, cof: crit.cof, criticality: crit.class, sce: crit.sce } });

	const thickness = asset.tracking === "thickness" && asset.odMm > 0 && asset.nominalThicknessMm > 0;
	const out = { tag: asset.tag, tracking: thickness ? "thickness" : "condition", cof: crit.cof, criticality: crit.class, sce: crit.sce };

	let pofBase;
	let baseDate = null;
	let rlAtLast = null;
	const installBase = asset.installYear ? `${asset.installYear}-07-01` : null;

	if (thickness) {
		const tm = computeTmin(asset, config);
		lines.push(...tm.lines);
		out.tmin = tm.tmin;
		if (!tm.ok) incomplete.push(...tm.missing);

		const series = inspections
			.map((i) => ({ date: i.date, t: governingThickness(i.readings) }))
			.filter((p) => p.t !== null);
		if (series.length) {
			const cor = computeCorrosion(asset, series, config);
			lines.push(...cor.lines);
			Object.assign(out, { tLast: cor.tLast, tLastDate: cor.tLastDate, crLT: cor.crLT ?? null, crST: cor.crST ?? null, cr: cor.cr, series: cor.series });
			baseDate = cor.tLastDate;
			if (tm.ok) {
				rlAtLast = (cor.tLast - tm.tmin) / cor.cr;
				const since = Math.max(0, yearsBetween(cor.tLastDate, todayIso));
				out.rlRaw = rlAtLast - since;
				out.rl = Math.max(0, out.rlRaw);
				out.tEst = round2(cor.tLast - cor.cr * since);
				pofBase = pofFromRemainingLife(out.rlRaw, config.pofThresholds);
				lines.push({ code: "remaining_life", params: { tLast: cor.tLast, tmin: tm.tmin, cr: cor.cr, rlAtLast, since, rl: out.rl, belowTmin: cor.tLast < tm.tmin } });
				lines.push({ code: "pof_from_rl", params: { rl: out.rl, pof: pofBase } });
			}
		} else {
			lines.push({ code: "no_thickness_data", params: { pof: config.defaultPofNoData } });
		}
		if (pofBase === undefined) pofBase = config.defaultPofNoData;
		if (baseDate === null) baseDate = installBase;
	} else {
		const graded = inspections.filter((i) => i.grade);
		const last = graded[graded.length - 1];
		if (last) {
			pofBase = last.grade;
			baseDate = last.date;
			out.lastGrade = last.grade;
			out.lastGradeDate = last.date;
			lines.push({ code: "pof_from_grade", params: { grade: last.grade, date: last.date, pof: pofBase } });
		} else {
			pofBase = config.defaultPofNoData;
			baseDate = installBase;
			lines.push({ code: "no_condition_data", params: { pof: pofBase } });
		}
	}

	// Modificateurs de PoF
	let pof = pofBase;
	const urgent = (input.openAnomalies || []).filter((a) => a.priority === "P1" || a.priority === "P2");
	out.openAnomalies = (input.openAnomalies || []).length;
	if (urgent.length && pof < 5) { pof += 1; lines.push({ code: "mod_open_anomaly", params: { count: urgent.length, pof } }); }
	else if (urgent.length) lines.push({ code: "mod_open_anomaly_capped", params: { count: urgent.length } });

	// Intervalle d'inspection
	const matrix = config.matrix;
	let risk = matrix[pof - 1][crit.cof - 1];
	let interval = config.intervals[risk];
	lines.push({ code: "risk_matrix", params: { pof, cof: crit.cof, risk } });
	lines.push({ code: "interval_risk", params: { risk, months: interval } });
	if (thickness && rlAtLast !== null) {
		const cap = Math.max(0, Math.floor(rlAtLast * 6)); // moitié de la durée de vie résiduelle, en mois
		if (cap < interval) { interval = cap; lines.push({ code: "interval_cap_rl", params: { months: cap, rlAtLast } }); }
	}
	const classMax = config.classMaxInterval?.[asset.classCode];
	if (classMax != null && classMax < interval) { interval = classMax; lines.push({ code: "interval_cap_class", params: { classCode: asset.classCode, months: classMax } }); }

	// Échéance
	let dueDate = null, daysToDue = null, status = "unknown";
	if (baseDate) {
		dueDate = addMonths(baseDate, interval);
		daysToDue = daysBetween(todayIso, dueDate);
		status = daysToDue < 0 ? "overdue" : daysToDue <= config.dueSoonDays ? "due_soon" : "planned";
		lines.push({ code: "due_date", params: { baseDate, months: interval, dueDate, daysToDue, status } });
	} else {
		incomplete.push("baseDate");
		lines.push({ code: "no_base_date", params: {} });
	}
	const riskBeforeOverdue = risk;
	if (status === "overdue" && pof < 5) {
		pof += 1; risk = matrix[pof - 1][crit.cof - 1];
		lines.push({ code: "mod_overdue", params: { pof, risk, daysOverdue: -daysToDue } });
	}

	return Object.assign(out, {
		pofBase, pof, risk, riskBeforeOverdue, intervalMonths: interval, baseDate, dueDate, daysToDue, status,
		rlAtLast, calculable: incomplete.length === 0, incomplete, lines,
		endOfLife: (out.rl != null && out.rl < config.endOfLifeRlYears) || urgent.length > 0,
	});
}

module.exports = { evaluateAsset, criticality, pofFromRemainingLife, clampPof };
