const { addDays, daysBetween } = require("./dates");

const ORDER = ["P1", "P2", "P3", "P4"]; // P1 = la plus urgente

/** Priorité la plus urgente d'une liste (ou null). */
const mostUrgent = (list) => list.filter(Boolean).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? null;

/**
 * Suggestion d'anomalie après une inspection (proposition à confirmer par l'utilisateur, jamais créée automatiquement).
 * evalResult = résultat de evaluateAsset APRÈS prise en compte de l'inspection ; grade = grade calculé (ou null).
 * Déclencheurs : épaisseur sous t_min, durée de vie résiduelle < 5 ans, grade ≥ 3.
 */
function suggestAnomaly({ evalResult, grade }, config) {
	const s = config.anomalySuggestion;
	const triggers = [];
	// Épaisseur mesurée sous t_min sur N'IMPORTE QUEL CML (pas seulement le CML gouvernant).
	if (evalResult?.belowTmin) {
		triggers.push({ code: "below_tmin", priority: s.belowTmin, params: { tLast: evalResult.tMeasuredMin, tmin: evalResult.tmin } });
	}
	if (evalResult?.rl != null && !evalResult.belowTmin) {
		if (evalResult.rl < 2) triggers.push({ code: "rl_under_2", priority: s.rlUnder2, params: { rl: evalResult.rl } });
		else if (evalResult.rl < 5) triggers.push({ code: "rl_under_5", priority: s.rlUnder5, params: { rl: evalResult.rl } });
	}
	if (grade === 4) triggers.push({ code: "grade_4", priority: s.grade4, params: { grade } });
	else if (grade === 3) triggers.push({ code: "grade_3", priority: s.grade3, params: { grade } });
	if (!triggers.length) return null;
	return { priority: mostUrgent(triggers.map((t) => t.priority)), triggers };
}

/** Échéance cible d'une anomalie selon sa priorité. */
const targetDate = (priority, fromDate, config) => addDays(fromDate, config.priorityDays[priority]);

/** Une anomalie ne peut être clôturée que si toutes ses actions sont terminées. */
function canClose(actions) {
	const open = (actions || []).filter((a) => !a.done);
	return { ok: open.length === 0, openCount: open.length };
}

/** État d'une réparation temporaire : 'expired' | 'expiring' (≤ repairAlertDays) | 'ok'. */
function repairStatus(expiryDate, todayIso, config) {
	const d = daysBetween(todayIso, expiryDate);
	return { daysLeft: d, status: d < 0 ? "expired" : d <= config.repairAlertDays ? "expiring" : "ok" };
}

/** Une anomalie est-elle en retard par rapport à son échéance cible ? */
const isOverdue = (anomaly, todayIso) => anomaly.status !== "Closed" && !!anomaly.dueDate && daysBetween(todayIso, anomaly.dueDate) < 0;

module.exports = { ORDER, mostUrgent, suggestAnomaly, targetDate, canClose, repairStatus, isOverdue };
