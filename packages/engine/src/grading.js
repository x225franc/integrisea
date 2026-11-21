// Gabarits d'inspection et calcul automatique du grade (1 = bon … 4 = mauvais).
// Un gabarit est une donnée (JSON) : champs + règles de notation, donc configurable par l'administrateur.
//
// Types de champs : cml (relevés d'épaisseur), grade (1–4), select (liste), num (nombre),
//                   pf (conforme / non conforme : 'Pass' | 'Fail'), text, textarea.
//
// Règles de notation (le grade final = max du grade saisi et de tous les grades imposés par les règles, plafonné à 4) :
//   { type:'anyFail', grade }                      un champ 'pf' non conforme impose ≥ grade
//   { type:'failCountMap', map:[g0,g1,g2,…] }       grade selon le nombre de champs 'pf' non conformes
//   { type:'deviation', ref, actual, steps:[[seuil, grade],…] }   écart relatif |actual−ref|/ref ; steps triés par seuil décroissant, strict >
//   { type:'equals', field, value, grade }
//   { type:'gt', field, steps:[[seuil, grade],…] }    valeur > seuil (steps triés par seuil décroissant)

const MAX_GRADE = 4;
const clampGrade = (g) => Math.min(MAX_GRADE, Math.max(1, Math.round(g)));

/** Retourne { grade, reasons[] } ; grade = null pour un gabarit sans notation (relevés d'épaisseur). */
function computeGrade(template, data) {
	const hasGradeLogic = template.fields.some((f) => f.t === "grade") || (template.rules || []).length > 0;
	if (!hasGradeLogic) return { grade: null, reasons: [] };
	const reasons = [];
	let grade = data.grade ? clampGrade(Number(data.grade)) : 1;
	if (data.grade) reasons.push({ code: "grade_entered", params: { grade } });
	const bump = (g, reason) => {
		if (g > grade) { grade = g; reasons.push(reason); }
	};
	const pfFields = template.fields.filter((f) => f.t === "pf");
	const fails = pfFields.filter((f) => data[f.k] === "Fail").length;

	for (const r of template.rules || []) {
		switch (r.type) {
			case "anyFail":
				if (fails > 0) bump(r.grade, { code: "grade_fail", params: { fails, grade: r.grade } });
				break;
			case "severityFail": {
				// Gravité par point de contrôle : un point « critique » non conforme impose ≥ critical, tout autre point non conforme
				// impose ≥ normal, et `countAtLeast` points non conformes (ou plus) imposent countGrade. Gravité = champ `sev` ('critical' | autre).
				const failed = pfFields.filter((f) => data[f.k] === "Fail");
				const critical = failed.filter((f) => f.sev === "critical");
				if (critical.length) bump(r.critical, { code: "grade_fail_critical", params: { fails: critical.length, grade: r.critical, fields: critical.map((f) => f.k) } });
				if (failed.length) bump(r.normal, { code: "grade_fail", params: { fails: failed.length, grade: r.normal } });
				if (failed.length >= r.countAtLeast) bump(r.countGrade, { code: "grade_fail_count", params: { fails: failed.length, grade: r.countGrade } });
				break;
			}
			case "failCountMap": {
				const g = r.map[Math.min(fails, r.map.length - 1)];
				bump(g, { code: "grade_fail_count", params: { fails, grade: g } });
				break;
			}
			case "deviation": {
				const ref = Number(data[r.ref]), act = Number(data[r.actual]);
				if (ref > 0 && act > 0) {
					const dev = Math.abs(act - ref) / ref;
					const step = r.steps.find(([thr]) => dev > thr);
					if (step) bump(step[1], { code: "grade_deviation", params: { deviation: dev, grade: step[1] } });
				}
				break;
			}
			case "equals":
				if (data[r.field] === r.value) bump(r.grade, { code: "grade_equals", params: { field: r.field, value: r.value, grade: r.grade } });
				break;
			case "gt": {
				const v = Number(data[r.field]);
				const step = Number.isFinite(v) ? r.steps.find(([thr]) => v > thr) : null;
				if (step) bump(step[1], { code: "grade_threshold", params: { field: r.field, value: v, grade: step[1] } });
				break;
			}
			default:
				throw new Error(`Règle de notation inconnue : ${r.type}`);
		}
	}
	return { grade: clampGrade(grade), reasons };
}

/** Plus faible épaisseur parmi les relevés (CML gouvernant) ; null si aucun relevé valide. */
function governingThickness(readings) {
	const v = (readings || []).map((r) => Number(r.t ?? r)).filter((x) => Number.isFinite(x) && x > 0);
	return v.length ? Math.min(...v) : null;
}

const notes = { k: "notes", l: "Findings / notes", t: "textarea" };
const grade = { k: "grade", l: "Condition grade (1 good – 4 poor)", t: "grade" };

/** Gabarits fournis (cahier des charges §4.4). */
function defaultTemplates() {
	return [
		{ id: "UT", name: "UT thickness survey", classes: ["PIPE", "PV", "HX", "RISER"], fields: [{ k: "readings", l: "Thickness readings by CML (mm)", t: "cml" }, { k: "coating", l: "External coating condition", t: "select", o: ["Good", "Fair", "Poor"] }, notes], rules: [] },
		{ id: "GVI", name: "General visual inspection", classes: ["PIPE", "PV", "HX", "PSV", "RISER", "STR", "EX", "HOSE", "SBT"], fields: [grade, notes], rules: [] },
		{
			id: "EXD", name: "Detailed Ex inspection (IEC 60079-17)", classes: ["EX"],
			fields: [
				{ k: "c1", l: "Marking and certificate match the area classification", t: "pf", sev: "critical" }, { k: "c2", l: "Enclosure or glass: no corrosion or superficial damage", t: "pf" },
				{ k: "c2b", l: "Enclosure or glass: no crack, breakage or deformation", t: "pf", sev: "critical" },
				{ k: "c3", l: "Flamepath gaps and fasteners satisfactory", t: "pf", sev: "critical" }, { k: "c4", l: "Cable glands secure and correct type", t: "pf", sev: "critical" },
				{ k: "c5", l: "Earthing and bonding intact", t: "pf", sev: "critical" }, { k: "c6", l: "No unauthorised modifications", t: "pf", sev: "critical" }, notes,
			],
			// Gravité par point : critique non conforme → ≥ 3 ; autre non conforme → ≥ 2 ; 3 non conformes ou plus → 4. (provisoire)
			rules: [{ type: "severityFail", critical: 3, normal: 2, countAtLeast: 3, countGrade: 4 }],
		},
		{
			id: "PSV", name: "PSV bench test", classes: ["PSV"],
			fields: [{ k: "set", l: "Set pressure (barg)", t: "num" }, { k: "pop", l: "As-found pop pressure (barg)", t: "num" }, { k: "seat", l: "Seat tightness test", t: "pf" }, notes],
			rules: [{ type: "anyFail", grade: 3 }, { type: "deviation", ref: "set", actual: "pop", steps: [[0.10, 4], [0.03, 3]] }],
		},
		{
			id: "STR", name: "Structural close visual inspection", classes: ["STR"],
			fields: [grade, { k: "coating", l: "Coating breakdown (%)", t: "num" }, { k: "crack", l: "Crack-like indications found", t: "select", o: ["No", "Yes"] }, notes],
			rules: [{ type: "equals", field: "crack", value: "Yes", grade: 4 }, { type: "gt", field: "coating", steps: [[30, 3]] }],
		},
		{ id: "HOSE", name: "Hose inspection & pressure test", classes: ["HOSE"], fields: [grade, { k: "ptest", l: "Hydrostatic pressure test", t: "pf" }, notes], rules: [{ type: "anyFail", grade: 3 }] },
		{ id: "ANN", name: "Riser annulus vent test", classes: ["RISER"], fields: [grade, { k: "vent", l: "Annulus vent / vacuum test", t: "pf" }, notes], rules: [{ type: "anyFail", grade: 3 }] },
		{
			id: "SBT", name: "Small-bore tubing inspection", classes: ["SBT"],
			fields: [grade, { k: "loose", l: "Loose or mixed fittings found (count)", t: "num" }, notes],
			rules: [{ type: "gt", field: "loose", steps: [[3, 3], [0, 2]] }],
		},
	];
}

module.exports = { computeGrade, governingThickness, defaultTemplates, clampGrade };
