// Consultation de la piste d'audit : administrateur (tout) ou ingénieur (ses installations). Lecture seule.
const router = require("express").Router();
const db = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { wrap, forbidden } = require("../utils/errors");
const { parse, z } = require("../utils/validate");
const { facilityIdsWithRole } = require("../services/permissions");

const pj = (v) => (typeof v === "string" ? JSON.parse(v) : v);

router.get("/", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({
		entity: z.string().max(40).optional(), entityId: z.string().max(60).optional(), user: z.coerce.number().int().optional(),
		facility: z.coerce.number().int().optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional(),
		page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50),
	}), req.query);
	const ids = facilityIdsWithRole(req.user, "engineer");
	if (ids && !ids.length) throw forbidden();
	const where = [], params = [];
	if (ids) { where.push("facility_id IN (?)"); params.push(ids); }
	if (q.entity) { where.push("entity = ?"); params.push(q.entity); }
	if (q.entityId) { where.push("entity_id = ?"); params.push(q.entityId); }
	if (q.user) { where.push("user_id = ?"); params.push(q.user); }
	if (q.facility) { where.push("facility_id = ?"); params.push(q.facility); }
	if (q.from) { where.push("occurred_at >= ?"); params.push(q.from); }
	if (q.to) { where.push("occurred_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(q.to); }
	const w = where.length ? "WHERE " + where.join(" AND ") : "";
	const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM audit_log ${w}`, params);
	const [rows] = await db.query(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, q.limit, (q.page - 1) * q.limit]);
	res.json({
		total,
		items: rows.map((r) => ({
			id: r.id, occurredAt: r.occurred_at, userId: r.user_id, userEmail: r.user_email, action: r.action, entity: r.entity,
			entityId: r.entity_id, entityLabel: r.entity_label, facilityId: r.facility_id, before: pj(r.before_json), after: pj(r.after_json), ip: r.ip,
		})),
	});
}));

module.exports = router;
