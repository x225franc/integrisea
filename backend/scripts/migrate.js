// Applique les migrations SQL de database/migrations dans l'ordre alphabétique (une seule fois chacune).
require("../config/env");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const dir = path.resolve(__dirname, "../../database/migrations");

async function migrate() {
	const conn = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT || 3306),
		user: process.env.DB_USER,
		password: process.env.DB_PASS,
		database: process.env.DB_NAME,
		multipleStatements: true,
	});
	try {
		await conn.query(
			"CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		);
		const [rows] = await conn.query("SELECT name FROM schema_migrations");
		const done = new Set(rows.map((r) => r.name));
		const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
		let applied = 0;
		for (const f of files) {
			if (done.has(f)) continue;
			console.log("→ migration", f);
			await conn.query(fs.readFileSync(path.join(dir, f), "utf8"));
			await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [f]);
			applied++;
		}
		console.log(applied ? `${applied} migration(s) appliquée(s).` : "Base déjà à jour.");
	} finally {
		await conn.end();
	}
}

if (require.main === module) migrate().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { migrate };
