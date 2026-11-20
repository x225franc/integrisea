// Données initiales : classes, gabarits d'inspection, administrateur, puis (hors production) un jeu de démonstration FICTIF :
// 2 installations, 41 actifs, historique d'inspections, anomalies, stratégies, pièces, documents et utilisateurs de démo.
// Idempotent : peut être relancé sans doublons.
require("../config/env");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const db = require("../config/db");
const engine = require("../../packages/engine");
const { DEMO_ALLOWABLE_STRESS, DEMO_MATERIAL_FAMILIES } = require("../services/settings");
const risk = require("../services/risk");

const CLASSES = [
	["PIPE", "Process piping", "Tuyauteries de procédé", "thickness"], ["PV", "Pressure vessel", "Appareil à pression", "thickness"],
	["HX", "Heat exchanger", "Échangeur", "thickness"], ["PSV", "Pressure safety valve", "Soupape de sécurité", "condition"],
	["RISER", "Riser", "Riser", "thickness"], ["STR", "Structure", "Structure", "condition"], ["EX", "Ex equipment", "Matériel Ex", "condition"],
	["HOSE", "Hose", "Flexible", "condition"], ["SBT", "Small-bore tubing", "Tubing de petit diamètre", "condition"],
];
const FACILITIES = [["AUR", "FPSO Aurora", "Turret-moored FPSO"], ["WHA", "Wellhead Platform Alpha", "Fixed jacket wellhead platform"]];
const SYSTEMS = [
	["AUR-M10", "AUR", "M10 Separation module"], ["AUR-M20", "AUR", "M20 Gas compression module"], ["AUR-M30", "AUR", "M30 Water injection module"],
	["AUR-M40", "AUR", "M40 Produced water treatment"], ["AUR-M50", "AUR", "M50 Power generation & fuel gas"], ["AUR-HUL", "AUR", "Hull & marine systems"],
	["AUR-TUR", "AUR", "Turret & swivel"], ["WHA-TOP", "WHA", "Topsides process"], ["WHA-STR", "WHA", "Jacket & structures"], ["WHA-RIS", "WHA", "Risers & conductors"],
];
// Disciplines de la bibliothèque AMDE (données du prototype) → disciplines de l'organisation. Electrical : provisoire, à confirmer.
const DISCIPLINE_MAP = { Integrity: "Pressure Systems", Mechanical: "Pressure Systems", Instrument: "Pressure Systems", Electrical: "Pressure Systems", Structural: "Structural", Subsea: "Pipelines" };
const read = (f) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../database/seeds", f), "utf8"));
const d10 = (v) => String(v).slice(0, 10);

async function seedBase() {
	for (const [i, [code, en, fr, tracking]] of CLASSES.entries()) {
		await db.query("INSERT INTO asset_classes (code,name_en,name_fr,tracking,default_discipline,sort_order) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE code=code",
			[code, en, fr, tracking, engine.DEFAULT_CLASS_DISCIPLINE[code] ?? null, i]);
	}
	for (const t of engine.defaultTemplates()) {
		await db.query("INSERT INTO inspection_templates (id,name,classes,fields,`rules`) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
			[t.id, t.name, JSON.stringify(t.classes), JSON.stringify(t.fields), JSON.stringify(t.rules)]);
	}
	const email = (process.env.SEED_ADMIN_EMAIL || "").toLowerCase();
	const pwd = process.env.SEED_ADMIN_PASSWORD;
	if (email && pwd && !/change_me/i.test(pwd)) {
		await db.query("INSERT INTO users (email,password_hash,full_name,is_admin) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE email=email", [email, await bcrypt.hash(pwd, 12), "Administrateur"]);
		console.log("Administrateur :", email);
	} else {
		console.warn("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD absents ou non remplacés : aucun administrateur créé.");
	}
}

async function seedDemo() {
	for (const [code, name, type] of FACILITIES) await db.query("INSERT INTO facilities (code,name,type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE code=code", [code, name, type]);
	const [facs] = await db.query("SELECT id, code FROM facilities");
	const facId = Object.fromEntries(facs.map((f) => [f.code, f.id]));
	for (const [code, fac, name] of SYSTEMS) await db.query("INSERT INTO systems (code,facility_id,name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE code=code", [code, facId[fac], name]);
	const [syss] = await db.query("SELECT id, code FROM systems");
	const sysId = Object.fromEntries(syss.map((s) => [s.code, s.id]));

	for (const a of read("demo-assets.json")) {
		await db.query(
			`INSERT INTO assets (tag,system_id,class_code,discipline,description,fluid,material,design_pressure_barg,design_temp_c,od_mm,nominal_thickness_mm,install_year,degradation_mechanisms,crit_s,crit_e,crit_p)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE tag=tag`,
			[a.tag, sysId[a.system], a.cls, engine.DEFAULT_CLASS_DISCIPLINE[a.cls] ?? null, a.description, a.fluid, a.material, a.design_pressure_barg, a.design_temp_c, a.od_mm, a.nominal_thickness_mm, a.install_year,
				JSON.stringify(a.degradation_mechanisms), a.crit?.[0] ?? null, a.crit?.[1] ?? null, a.crit?.[2] ?? null]);
	}
	const [assets] = await db.query("SELECT id, tag, class_code FROM assets");
	const assetId = Object.fromEntries(assets.map((a) => [a.tag, a.id]));

	// Valeurs de DÉMONSTRATION de contraintes admissibles (fictives, non validées) : sans elles, aucun t_min n'est calculable.
	// Marquées « fictitious » : l'interface les étiquette FICTIVES. Elles couvrent −29 °C à 200 °C ; au-delà, l'actif reste non calculable.
	await db.query("INSERT INTO config_settings (setting_key, value_json) VALUES ('allowableStress', ?) ON DUPLICATE KEY UPDATE setting_key = setting_key", [JSON.stringify(DEMO_ALLOWABLE_STRESS)]);
	await db.query("INSERT INTO config_settings (setting_key, value_json) VALUES ('materialFamilies', ?) ON DUPLICATE KEY UPDATE setting_key = setting_key", [JSON.stringify(DEMO_MATERIAL_FAMILIES)]);

	const hist = read("demo-history.json");
	const [[{ n: nInsp }]] = await db.query("SELECT COUNT(*) AS n FROM inspections");
	if (!nInsp) {
		const [tpls] = await db.query("SELECT id, fields, `rules` FROM inspection_templates");
		const tplById = Object.fromEntries(tpls.map((t) => [t.id, { fields: typeof t.fields === "string" ? JSON.parse(t.fields) : t.fields, rules: typeof t.rules === "string" ? JSON.parse(t.rules) : t.rules }]));
		let n = 0;
		for (const i of hist.inspections) {
			if (!assetId[i.tag]) continue;
			const g = engine.computeGrade(tplById[i.tpl], i.data);
			const min = i.readings ? engine.governingThickness(i.readings) : null;
			const notes = i.data.notes || null;
			const { notes: _n, ...data } = i.data;
			n++;
			await db.query(
				`INSERT INTO inspections (reference, asset_id, template_id, performed_on, inspector, data, readings, min_thickness, grade, grade_reasons, notes)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
				[`IR-${String(n).padStart(5, "0")}`, assetId[i.tag], i.tpl, i.date, i.inspector, JSON.stringify(data), i.readings ? JSON.stringify(i.readings) : null, min, g.grade, JSON.stringify(g.reasons), notes]);
		}
		console.log(`  ${n} inspections`);
	}

	const [[{ n: nAn }]] = await db.query("SELECT COUNT(*) AS n FROM anomalies");
	if (!nAn) {
		const cfg = engine.defaultConfig();
		for (const [k, a] of hist.anomalies.entries()) {
			if (!assetId[a.tag]) continue;
			const status = a.status === "In progress" ? "InProgress" : a.status;
			const due = engine.targetDate(a.priority, a.raised, cfg);
			const [r] = await db.query(
				"INSERT INTO anomalies (reference, asset_id, title, description, priority, status, owner, raised_on, due_date, closed_on) VALUES (?,?,?,?,?,?,?,?,?,?)",
				[`AN-${String(k + 1).padStart(4, "0")}`, assetId[a.tag], a.title, a.desc, a.priority, status, a.owner, a.raised, due, status === "Closed" ? engine.addDays(a.raised, 20) : null]);
			for (const { text, owner, done } of a.actions) await db.query("INSERT INTO anomaly_actions (anomaly_id, action_text, owner, done, done_on) VALUES (?,?,?,?,?)", [r.insertId, text, owner, done ? 1 : 0, done ? engine.addDays(a.raised, 10) : null]);
			if (a.temp) await db.query("INSERT INTO temporary_repairs (anomaly_id, repair_type, installed_on, expires_on) VALUES (?,?,?,?)", [r.insertId, a.temp.type, engine.addDays(a.raised, 14), a.temp.expiry]);
		}
		console.log(`  ${hist.anomalies.length} anomalies`);
	}

	const [[{ n: nF }]] = await db.query("SELECT COUNT(*) AS n FROM fmea_library");
	if (!nF) for (const s of hist.strategies) await db.query("INSERT INTO fmea_library (class_code,failure_mode,mechanism,effect,task,method,interval_months,discipline) VALUES (?,?,?,?,?,?,?,?)",
		[s.cls, s.mode, s.mech, s.effect, s.task, s.method, s.interval === "RBI" ? null : s.interval, DISCIPLINE_MAP[s.disc] ?? s.disc]);

	for (const m of hist.materials) {
		await db.query("INSERT INTO spare_parts (code,description,category,criticality,stock,min_stock) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE code=code", [m.code, m.desc, m.cat, m.crit, m.stock, m.min]);
		const [[p]] = await db.query("SELECT id FROM spare_parts WHERE code = ?", [m.code]);
		for (const t of m.tags) if (assetId[t]) await db.query("INSERT IGNORE INTO bom (asset_id, part_id, quantity) VALUES (?,?,1)", [assetId[t], p.id]);
	}

	const types = { "P&ID": "P&ID", Isometric: "Isometric", Datasheet: "Datasheet", Certificate: "Certificate", Drawing: "Drawing", Plan: "Plan", Report: "Report" };
	for (const d of hist.documents) {
		const [[ex]] = await db.query("SELECT id FROM documents WHERE doc_number = ?", [d.no]);
		if (ex) continue;
		const tagFac = d.tags[0] ? (await db.query("SELECT s.facility_id FROM assets a JOIN systems s ON s.id=a.system_id WHERE a.tag = ?", [d.tags[0]]))[0][0]?.facility_id : facId[d.no.slice(0, 3)] ?? null;
		const [r] = await db.query("INSERT INTO documents (doc_number,title,doc_type,facility_id,current_revision) VALUES (?,?,?,?,?)", [d.no, d.title, types[d.type] || "Other", tagFac ?? null, d.rev]);
		await db.query("INSERT INTO document_versions (document_id, revision, comment) VALUES (?,?,?)", [r.insertId, d.rev, "Jeu de démonstration (sans fichier)"]);
		for (const t of d.tags) if (assetId[t]) await db.query("INSERT IGNORE INTO document_assets (document_id, asset_id) VALUES (?,?)", [r.insertId, assetId[t]]);
	}

	// Utilisateurs de démonstration (mot de passe = SEED_ADMIN_PASSWORD, développement seulement).
	const pwd = process.env.SEED_ADMIN_PASSWORD;
	if (pwd && !/change_me/i.test(pwd)) {
		const hash = await bcrypt.hash(pwd, 12);
		const demo = [
			["ingenieur.aur@integrisea.local", "Ingénieur intégrité (Aurora)", [[facId.AUR, "engineer"]]],
			["inspecteur@integrisea.local", "Inspecteur (Aurora + Alpha)", [[facId.AUR, "inspector"], [facId.WHA, "inspector"]]],
			["lecteur.wha@integrisea.local", "Lecteur (Alpha)", [[facId.WHA, "reader"]]],
		];
		for (const [email, name, roles] of demo) {
			await db.query("INSERT INTO users (email,password_hash,full_name,is_admin) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE email=email", [email, hash, name]);
			const [[u]] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
			for (const [fid, role] of roles) await db.query("INSERT INTO user_facility_roles (user_id,facility_id,role) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)", [u.id, fid, role]);
		}
	}
	console.log(`Démo : ${FACILITIES.length} installations, ${SYSTEMS.length} systèmes, ${assets.length} actifs (fictifs).`);
}

async function seed() {
	const isProd = process.env.NODE_ENV === "production" || process.env.ENV === "production";
	await seedBase();
	if (isProd && !process.env.SEED_DEMO) console.log("Production : jeu de démonstration ignoré (SEED_DEMO=1 pour le forcer).");
	else await seedDemo();
	await risk.recompute(db, null);
	console.log("Risques calculés.");
}

if (require.main === module) seed().then(() => db.end()).catch((e) => { console.error(e); process.exit(1); });
module.exports = { seed };
