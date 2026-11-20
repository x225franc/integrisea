// Export au format de chargement GMAO — cible : IBM Maximo 7.6 (chargement par import de fichier / MXLoader).
// ⚠️ Le mapping des colonnes (sites, emplacements, classifications, plans de maintenance) est à confirmer avec l'équipe Maximo
// du client : les en-têtes ci-dessous suivent les noms d'attributs standard des objets ASSET et PM, mais sont adaptables ici.
const router = require("express").Router();
const db = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { wrap, forbidden } = require("../utils/errors");
const { parse, z } = require("../utils/validate");
const { scopeFor } = require("../services/scope");
const risk = require("../services/risk");
const { sendTable } = require("../services/tabular");

const q = z.object({ facility: z.coerce.number().int().optional(), format: z.enum(["csv", "xlsx"]).default("xlsx") });

// Réservé aux ingénieurs (et administrateurs) : export de données d'intégrité vers un système externe.
function scope(req, facility) {
	const sc = scopeFor(req.user, "s.facility_id", "engineer", facility);
	if (sc.empty) throw forbidden();
	return sc;
}

const ASSET_COLUMNS = ["SITEID", "ASSETNUM", "DESCRIPTION", "LOCATION", "STATUS", "ASSETTYPE", "INSTALLDATE", "IS_CRITICALITY", "IS_RISK", "IS_NEXT_INSPECTION"];
const PM_COLUMNS = ["PMNUM", "DESCRIPTION", "SITEID", "ASSETNUM", "STATUS", "FREQUENCY", "FREQUNIT", "NEXTDATE", "JPNUM"];

router.get("/maximo/assets", requireAuth, wrap(async (req, res) => {
	const p = parse(q, req.query);
	const sc = scope(req, p.facility);
	await risk.ensureFresh();
	const [rows] = await db.query(
		`SELECT f.code AS site, a.tag, a.description, s.code AS system_code, a.install_year, r.criticality, r.risk, r.due_date
		 FROM assets a JOIN systems s ON s.id=a.system_id JOIN facilities f ON f.id=s.facility_id LEFT JOIN asset_risk r ON r.asset_id=a.id
		 WHERE a.archived_at IS NULL ${sc.where.length ? "AND " + sc.where.join(" AND ") : ""} ORDER BY a.tag`, sc.params);
	await sendTable(res, "maximo-assets", ASSET_COLUMNS, rows.map((r) => ({
		SITEID: r.site, ASSETNUM: r.tag, DESCRIPTION: r.description, LOCATION: r.system_code, STATUS: "OPERATING", ASSETTYPE: "PRODUCTION",
		INSTALLDATE: r.install_year ? `${r.install_year}-07-01` : "", IS_CRITICALITY: r.criticality ?? "", IS_RISK: r.risk ?? "", IS_NEXT_INSPECTION: r.due_date ? String(r.due_date).slice(0, 10) : "",
	})), p.format);
}));

// Plans de maintenance préventive : une inspection périodique par actif, à la fréquence calculée par le RBI.
router.get("/maximo/pm", requireAuth, wrap(async (req, res) => {
	const p = parse(q, req.query);
	const sc = scope(req, p.facility);
	await risk.ensureFresh();
	const [rows] = await db.query(
		`SELECT f.code AS site, a.tag, a.description, r.interval_months, r.due_date
		 FROM assets a JOIN systems s ON s.id=a.system_id JOIN facilities f ON f.id=s.facility_id JOIN asset_risk r ON r.asset_id=a.id
		 WHERE a.archived_at IS NULL AND r.due_date IS NOT NULL AND r.interval_months > 0 ${sc.where.length ? "AND " + sc.where.join(" AND ") : ""} ORDER BY a.tag`, sc.params);
	await sendTable(res, "maximo-pm", PM_COLUMNS, rows.map((r) => ({
		PMNUM: `IS-${r.tag}`.slice(0, 20), DESCRIPTION: `Inspection ${r.tag} (RBI)`.slice(0, 100), SITEID: r.site, ASSETNUM: r.tag, STATUS: "ACTIVE",
		FREQUENCY: r.interval_months, FREQUNIT: "MONTHS", NEXTDATE: String(r.due_date).slice(0, 10), JPNUM: "",
	})), p.format);
}));

module.exports = router;
