// Agrégats pour le tableau de bord (§4.1) à partir de résultats evaluateAsset().

/** Nombre d'actifs par case de la matrice : clé "pof-cof". */
function riskCounts(evals) {
	const c = {};
	for (const e of evals) { const k = `${e.pof}-${e.cof}`; c[k] = (c[k] || 0) + 1; }
	return c;
}

function summarize(evals) {
	const by = (f) => evals.filter(f).length;
	return {
		assets: evals.length,
		criticalA: by((e) => e.criticality === "A"),
		overdue: by((e) => e.status === "overdue"),
		dueSoon: by((e) => e.status === "due_soon"),
		highRisk: by((e) => e.risk === "H"),
		notCalculable: by((e) => !e.calculable),
		matrix: riskCounts(evals),
	};
}

module.exports = { riskCounts, summarize };
