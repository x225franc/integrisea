// Pont entre la base de données et le moteur de calcul (packages/engine) : construit les entrées,
// exécute l'évaluation et met à jour le cache asset_risk.
const db = require("../config/db");
const engine = require("../../packages/engine");
const { loadSettings } = require("./settings");

const pj = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const iso = (d) => (d ? String(d).slice(0, 10) : null);

/** Notes de conséquence effectives : valeur de l'actif sinon valeur par défaut du fluide sinon null. */
function effectiveCrit(a, fluidCriticality) {
	const def = fluidCriticality[a.fluid] || [];
	return { s: a.crit_s ?? def[0] ?? null, e: a.crit_e ?? def[1] ?? null, p: a.crit_p ?? def[2] ?? null };
}

/** Construit les entrées du moteur pour une liste d'actifs (null = tous). */
async function buildInputs(conn, assetIds, settings) {
	const where = assetIds ? "WHERE a.id IN (?)" : "";
	const p = assetIds ? [assetIds] : [];
	const [assets] = await conn.query(
		`SELECT a.*, c.tracking FROM assets a JOIN asset_classes c ON c.code = a.class_code ${where}`, p);
	if (!assets.length) return [];
	const ids = assets.map((a) => a.id);
	const [insp] = await conn.query("SELECT asset_id, performed_on, grade, readings FROM inspections WHERE asset_id IN (?) ORDER BY performed_on", [ids]);
	const [anom] = await conn.query("SELECT asset_id, priority FROM anomalies WHERE asset_id IN (?) AND status <> 'Closed'", [ids]);
	const byInsp = new Map(), byAn = new Map();
	for (const i of insp) (byInsp.get(i.asset_id) || byInsp.set(i.asset_id, []).get(i.asset_id)).push({ date: iso(i.performed_on), grade: i.grade, readings: pj(i.readings) });
	for (const n of anom) (byAn.get(n.asset_id) || byAn.set(n.asset_id, []).get(n.asset_id)).push({ priority: n.priority });
	return assets.map((a) => ({
		row: a,
		input: {
			asset: {
				tag: a.tag, classCode: a.class_code, tracking: a.tracking, material: a.material, designPressureBarg: a.design_pressure_barg,
				designTempC: a.design_temp_c === null ? null : Number(a.design_temp_c),
				odMm: a.od_mm, nominalThicknessMm: a.nominal_thickness_mm, installYear: a.install_year, crit: effectiveCrit(a, settings.fluidCriticality),
			},
			inspections: byInsp.get(a.id) || [],
			openAnomalies: byAn.get(a.id) || [],
		},
	}));
}

async function upsertRisk(conn, assetId, r, todayIso) {
	await conn.query(
		`REPLACE INTO asset_risk (asset_id,tracking,pof,pof_base,cof,risk,criticality,sce,tmin,t_last,corrosion_rate,remaining_life,interval_months,base_date,due_date,days_to_due,schedule_status,calculable,end_of_life,result,computed_for)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		[assetId, r.tracking, r.pof, r.pofBase, r.cof, r.risk, r.criticality, r.sce ? 1 : 0, r.tmin ?? null, r.tLast ?? null, r.cr ?? null,
			r.rl != null ? Math.round(r.rl * 100) / 100 : null, r.intervalMonths, r.baseDate, r.dueDate, r.daysToDue,
			r.status === "due_soon" ? "due_soon" : r.status, r.calculable ? 1 : 0, r.endOfLife ? 1 : 0, JSON.stringify({ ...r, engineVersion: engine.ENGINE_VERSION }), todayIso],
	);
}

/** Recalcule le risque de ces actifs (null = tous) et met le cache à jour. Retourne les résultats par id. */
async function recompute(conn, assetIds = null, todayIso = engine.today()) {
	const settings = await loadSettings(conn);
	const items = await buildInputs(conn, assetIds, settings);
	const out = new Map();
	for (const { row, input } of items) {
		const r = engine.evaluateAsset(input, settings.engine, todayIso);
		await upsertRisk(conn, row.id, r, todayIso);
		out.set(row.id, r);
	}
	return out;
}

/** Évalue sans écrire (fiche actif, simulation). */
async function evaluateOne(conn, assetId, todayIso = engine.today()) {
	const settings = await loadSettings(conn);
	const [item] = await buildInputs(conn, [assetId], settings);
	if (!item) return null;
	return { evaluation: engine.evaluateAsset(item.input, settings.engine, todayIso), input: item.input, row: item.row };
}

/**
 * Recalcule tout si le cache est absent, date d'un autre jour (les échéances évoluent avec la date)
 * ou a été produit par une autre version du moteur (règles de calcul modifiées).
 */
async function ensureFresh() {
	const today = engine.today();
	const [[c]] = await db.query(
		`SELECT (SELECT COUNT(*) FROM assets a LEFT JOIN asset_risk r ON r.asset_id = a.id WHERE r.asset_id IS NULL) AS missing,
		        (SELECT COUNT(*) FROM asset_risk WHERE computed_for <> ?) AS stale,
		        (SELECT COUNT(*) FROM asset_risk WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(result, '$.engineVersion')), '') <> ?) AS outdated`, [today, engine.ENGINE_VERSION]);
	if (c.missing > 0 || c.stale > 0 || c.outdated > 0) await recompute(db, null, today);
}

module.exports = { recompute, evaluateOne, ensureFresh, buildInputs, effectiveCrit };
