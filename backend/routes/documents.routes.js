// Registre documentaire (documents liés aux tags, versions, fichiers) et téléchargement sécurisé des fichiers.
const router = require("express").Router();
const filesRouter = require("express").Router();
const multer = require("multer");
const db = require("../config/db");
const { withTransaction } = db;
const { requireAuth } = require("../middleware/auth");
const { wrap, notFound, forbidden, badRequest, conflict } = require("../utils/errors");
const { parse, z, optStr } = require("../utils/validate");
const { recordAudit } = require("../services/audit");
const { hasRole, facilityIdsWithRole } = require("../services/permissions");
const storage = require("../services/storage");
const { sendTable } = require("../services/tabular");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const TYPES = ["P&ID", "Isometric", "Datasheet", "Certificate", "Drawing", "Report", "Plan", "Procedure", "Other"];

const map = (r) => ({ id: r.id, docNumber: r.doc_number, title: r.title, docType: r.doc_type, facilityId: r.facility_id, revision: r.current_revision, updatedAt: r.updated_at, fileId: r.file_id ?? null, assets: r.assets ?? undefined });

/** Un document sans installation est visible de tout utilisateur connecté ; sinon il faut un droit de lecture sur l'installation. */
const canSee = (user, doc) => doc.facility_id == null || hasRole(user, doc.facility_id, "reader");
/** Écriture : ingénieur de l'installation (administrateur pour un document sans installation). */
const canWrite = (user, facilityId) => (facilityId == null ? user.isAdmin : hasRole(user, facilityId, "engineer"));

const LATEST = "(SELECT v.file_id FROM document_versions v WHERE v.document_id = d.id ORDER BY v.id DESC LIMIT 1)";

router.get("/", requireAuth, wrap(async (req, res) => {
	const q = parse(z.object({ type: z.string().max(40).optional(), q: z.string().max(100).optional(), asset: z.coerce.number().int().optional(), facility: z.coerce.number().int().optional(),
		page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50), format: z.enum(["csv", "xlsx"]).optional() }), req.query);
	const ids = facilityIdsWithRole(req.user);
	const where = [], params = [];
	if (ids) { where.push("(d.facility_id IS NULL OR d.facility_id IN (?))"); params.push(ids.length ? ids : [0]); }
	if (q.facility) { where.push("d.facility_id = ?"); params.push(q.facility); }
	if (q.type) { where.push("d.doc_type = ?"); params.push(q.type); }
	if (q.asset) { where.push("EXISTS (SELECT 1 FROM document_assets da WHERE da.document_id = d.id AND da.asset_id = ?)"); params.push(q.asset); }
	if (q.q) { where.push("(d.doc_number LIKE ? OR d.title LIKE ?)"); const l = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`; params.push(l, l); }
	const w = where.length ? "WHERE " + where.join(" AND ") : "";
	const sel = `SELECT d.*, ${LATEST} AS file_id, (SELECT COUNT(*) FROM document_assets da WHERE da.document_id = d.id) AS assets FROM documents d ${w} ORDER BY d.doc_number`;
	if (q.format) {
		const [rows] = await db.query(`${sel} LIMIT 20000`, params);
		return sendTable(res, "documents", ["docNumber", "title", "docType", "revision", "updatedAt"], rows.map(map), q.format);
	}
	const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM documents d ${w}`, params);
	const [rows] = await db.query(`${sel} LIMIT ? OFFSET ?`, [...params, q.limit, (q.page - 1) * q.limit]);
	res.json({ total, items: rows.map(map), types: TYPES });
}));

router.get("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const [[d]] = await db.query("SELECT * FROM documents WHERE id = ?", [req.params.id]);
	if (!d || !canSee(req.user, d)) throw notFound();
	const [versions] = await db.query("SELECT v.id, v.revision, v.file_id, v.comment, v.created_at, u.full_name AS by_name, f.original_name, f.size_bytes FROM document_versions v LEFT JOIN users u ON u.id=v.uploaded_by LEFT JOIN files f ON f.id=v.file_id WHERE v.document_id = ? ORDER BY v.id DESC", [d.id]);
	const [assets] = await db.query("SELECT a.id, a.tag FROM document_assets da JOIN assets a ON a.id=da.asset_id WHERE da.document_id = ? ORDER BY a.tag", [d.id]);
	res.json({ ...map(d), versions: versions.map((v) => ({ id: v.id, revision: v.revision, fileId: v.file_id, comment: v.comment, createdAt: v.created_at, by: v.by_name, fileName: v.original_name, size: v.size_bytes })), assets });
}));

async function storeUpload(req) {
	if (!req.file) return null;
	const mime = storage.sniff(req.file.buffer, req.file.originalname);
	if (!mime) throw badRequest("Type de fichier non accepté (PDF, PNG, JPEG, WebP, DOCX, XLSX)");
	return storage.put(req.file.buffer, { name: req.file.originalname, mime, userId: req.user.id });
}

const createSchema = z.object({
	docNumber: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(255), docType: z.enum(TYPES),
	facilityId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
	revision: z.string().trim().min(1).max(20).default("A"), comment: optStr(255),
	assetIds: z.preprocess((v) => (typeof v === "string" ? JSON.parse(v || "[]") : v ?? []), z.array(z.number().int().positive()).max(500)),
});

router.post("/", requireAuth, upload.single("file"), wrap(async (req, res) => {
	const d = parse(createSchema, req.body);
	if (!canWrite(req.user, d.facilityId)) throw forbidden();
	const file = await storeUpload(req);
	const id = await withTransaction(async (conn) => {
		const [[dup]] = await conn.query("SELECT id FROM documents WHERE doc_number = ?", [d.docNumber]);
		if (dup) throw conflict("Ce numéro de document existe déjà");
		const [r] = await conn.query("INSERT INTO documents (doc_number,title,doc_type,facility_id,current_revision,created_by) VALUES (?,?,?,?,?,?)", [d.docNumber, d.title, d.docType, d.facilityId, d.revision, req.user.id]);
		await conn.query("INSERT INTO document_versions (document_id, revision, file_id, comment, uploaded_by) VALUES (?,?,?,?,?)", [r.insertId, d.revision, file?.id ?? null, d.comment ?? null, req.user.id]);
		for (const aid of d.assetIds) {
			const [[ok]] = await conn.query("SELECT 1 AS ok FROM assets a JOIN systems s ON s.id=a.system_id WHERE a.id = ? AND (? IS NULL OR s.facility_id = ?)", [aid, d.facilityId, d.facilityId]);
			if (ok) await conn.query("INSERT IGNORE INTO document_assets (document_id, asset_id) VALUES (?,?)", [r.insertId, aid]);
		}
		await recordAudit(conn, req, { action: "create", entity: "document", entityId: r.insertId, label: d.docNumber, facilityId: d.facilityId, after: { docNumber: d.docNumber, title: d.title, docType: d.docType, revision: d.revision, file: file?.name ?? null, assets: d.assetIds.length } });
		return r.insertId;
	});
	res.status(201).json({ id });
}));

// Nouvelle révision d'un document (les précédentes sont conservées).
router.post("/:id(\\d+)/versions", requireAuth, upload.single("file"), wrap(async (req, res) => {
	const d = parse(z.object({ revision: z.string().trim().min(1).max(20), comment: optStr(255) }), req.body);
	const [[doc]] = await db.query("SELECT * FROM documents WHERE id = ?", [req.params.id]);
	if (!doc || !canSee(req.user, doc)) throw notFound();
	if (!canWrite(req.user, doc.facility_id)) throw forbidden();
	const [[dup]] = await db.query("SELECT id FROM document_versions WHERE document_id = ? AND revision = ?", [doc.id, d.revision]);
	if (dup) throw conflict("Cette révision existe déjà");
	const file = await storeUpload(req);
	if (!file) throw badRequest("Fichier manquant");
	await withTransaction(async (conn) => {
		await conn.query("INSERT INTO document_versions (document_id, revision, file_id, comment, uploaded_by) VALUES (?,?,?,?,?)", [doc.id, d.revision, file.id, d.comment ?? null, req.user.id]);
		await conn.query("UPDATE documents SET current_revision = ? WHERE id = ?", [d.revision, doc.id]);
		await recordAudit(conn, req, { action: "new_version", entity: "document", entityId: doc.id, label: doc.doc_number, facilityId: doc.facility_id, before: { revision: doc.current_revision }, after: { revision: d.revision, file: file.name, sha256: file.sha256 } });
	});
	res.status(201).json({ ok: true });
}));

router.put("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const d = parse(z.object({ title: z.string().trim().min(1).max(255).optional(), docType: z.enum(TYPES).optional(), assetIds: z.array(z.number().int().positive()).max(500).optional() }), req.body);
	await withTransaction(async (conn) => {
		const [[doc]] = await conn.query("SELECT * FROM documents WHERE id = ?", [req.params.id]);
		if (!doc || !canSee(req.user, doc)) throw notFound();
		if (!canWrite(req.user, doc.facility_id)) throw forbidden();
		await conn.query("UPDATE documents SET title = ?, doc_type = ? WHERE id = ?", [d.title ?? doc.title, d.docType ?? doc.doc_type, doc.id]);
		if (d.assetIds) {
			await conn.query("DELETE FROM document_assets WHERE document_id = ?", [doc.id]);
			for (const aid of d.assetIds) await conn.query("INSERT IGNORE INTO document_assets (document_id, asset_id) VALUES (?,?)", [doc.id, aid]);
		}
		await recordAudit(conn, req, { action: "update", entity: "document", entityId: doc.id, label: doc.doc_number, facilityId: doc.facility_id, before: { title: doc.title, docType: doc.doc_type }, after: { title: d.title ?? doc.title, docType: d.docType ?? doc.doc_type, assets: d.assetIds?.length } });
	});
	res.json({ ok: true });
}));

// --- Téléchargement d'un fichier : autorisé seulement via un objet auquel l'utilisateur a accès ---
async function canReadFile(user, fileId) {
	const [rows] = await db.query(
		`SELECT s.facility_id AS fid FROM inspection_attachments ia JOIN inspections i ON i.id=ia.inspection_id JOIN assets a ON a.id=i.asset_id JOIN systems s ON s.id=a.system_id WHERE ia.file_id = ?
		 UNION SELECT s.facility_id FROM inspections i JOIN assets a ON a.id=i.asset_id JOIN systems s ON s.id=a.system_id WHERE i.report_file_id = ?
		 UNION SELECT COALESCE(d.facility_id, 0) FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.file_id = ?`, [fileId, fileId, fileId]);
	return rows.some((r) => r.fid === 0 || hasRole(user, r.fid, "reader"));
}

filesRouter.get("/:id(\\d+)", requireAuth, wrap(async (req, res) => {
	const [[f]] = await db.query("SELECT * FROM files WHERE id = ?", [req.params.id]);
	if (!f || !(await canReadFile(req.user, f.id))) throw notFound();
	const buf = await storage.read(f);
	const inline = f.mime === "application/pdf" || f.mime.startsWith("image/");
	res.set({
		"Content-Type": f.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
		"Content-Disposition": `${inline && req.query.download !== "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
	});
	res.send(buf);
}));

module.exports = router;
module.exports.filesRouter = filesRouter;
