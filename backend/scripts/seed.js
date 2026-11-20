// Données initiales : classes, installations de démonstration, compte administrateur, actifs fictifs.
// Idempotent : peut être relancé sans doublons. Les actifs de démo sont fictifs.
require("../config/env");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const db = require("../config/db");

const CLASSES = [
	["PIPE", "Process piping", "Tuyauteries de procédé", "thickness"],
	["PV", "Pressure vessel", "Appareil à pression", "thickness"],
	["HX", "Heat exchanger", "Échangeur", "thickness"],
	["PSV", "Pressure safety valve", "Soupape de sécurité", "condition"],
	["RISER", "Riser", "Riser", "thickness"],
	["STR", "Structure", "Structure", "condition"],
	["EX", "Ex equipment", "Matériel Ex", "condition"],
	["HOSE", "Hose", "Flexible", "condition"],
	["SBT", "Small-bore tubing", "Tubing de petit diamètre", "condition"],
];

const FACILITIES = [
	["AUR", "FPSO Aurora", "Turret-moored FPSO"],
	["WHA", "Wellhead Platform Alpha", "Fixed jacket wellhead platform"],
];

const SYSTEMS = [
	["AUR-M10", "AUR", "M10 Separation module"], ["AUR-M20", "AUR", "M20 Gas compression module"],
	["AUR-M30", "AUR", "M30 Water injection module"], ["AUR-M40", "AUR", "M40 Produced water treatment"],
	["AUR-M50", "AUR", "M50 Power generation & fuel gas"], ["AUR-HUL", "AUR", "Hull & marine systems"],
	["AUR-TUR", "AUR", "Turret & swivel"],
	["WHA-TOP", "WHA", "Topsides process"], ["WHA-STR", "WHA", "Jacket & structures"], ["WHA-RIS", "WHA", "Risers & conductors"],
];

async function seed() {
	const isProd = process.env.NODE_ENV === "production" || process.env.ENV === "production";
	for (const [i, [code, en, fr, tracking]] of CLASSES.entries()) {
		await db.query(
			"INSERT INTO asset_classes (code,name_en,name_fr,tracking,sort_order) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE code=code",
			[code, en, fr, tracking, i],
		);
	}

	const email = (process.env.SEED_ADMIN_EMAIL || "").toLowerCase();
	const pwd = process.env.SEED_ADMIN_PASSWORD;
	if (email && pwd && !/change_me/i.test(pwd)) {
		const hash = await bcrypt.hash(pwd, 12);
		await db.query(
			"INSERT INTO users (email,password_hash,full_name,is_admin) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE email=email",
			[email, hash, "Administrateur"],
		);
		console.log("Administrateur :", email);
	} else {
		console.warn("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD absents ou non remplacés : aucun administrateur créé.");
	}

	if (isProd && !process.env.SEED_DEMO) {
		console.log("Production : jeu de données de démonstration ignoré (SEED_DEMO=1 pour le forcer).");
		return;
	}

	for (const [code, name, type] of FACILITIES) {
		await db.query("INSERT INTO facilities (code,name,type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE code=code", [code, name, type]);
	}
	const [facs] = await db.query("SELECT id, code FROM facilities");
	const facId = Object.fromEntries(facs.map((f) => [f.code, f.id]));
	for (const [code, fac, name] of SYSTEMS) {
		await db.query("INSERT INTO systems (code,facility_id,name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE code=code", [code, facId[fac], name]);
	}
	const [syss] = await db.query("SELECT id, code FROM systems");
	const sysId = Object.fromEntries(syss.map((s) => [s.code, s.id]));

	const demo = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../database/seeds/demo-assets.json"), "utf8"));
	for (const a of demo) {
		await db.query(
			`INSERT INTO assets (tag,system_id,class_code,description,fluid,material,design_pressure_barg,design_temp_c,od_mm,nominal_thickness_mm,install_year,degradation_mechanisms,crit_s,crit_e,crit_p)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE tag=tag`,
			[
				a.tag, sysId[a.system], a.cls, a.description, a.fluid, a.material, a.design_pressure_barg, a.design_temp_c,
				a.od_mm, a.nominal_thickness_mm, a.install_year, JSON.stringify(a.degradation_mechanisms),
				a.crit?.[0] ?? null, a.crit?.[1] ?? null, a.crit?.[2] ?? null,
			],
		);
	}
	console.log(`Démo : ${FACILITIES.length} installations, ${SYSTEMS.length} systèmes, ${demo.length} actifs (fictifs).`);
}

if (require.main === module) {
	seed().then(() => db.end()).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { seed };
