// Développement uniquement : supprime toutes les tables puis rejoue migrations et seed.
require("../config/env");
const mysql = require("mysql2/promise");
const { migrate } = require("./migrate");
const { seed } = require("./seed");
const db = require("../config/db");

(async () => {
	if (process.env.NODE_ENV === "production" || process.env.ENV === "production") {
		console.error("db:reset est interdit en production.");
		process.exit(1);
	}
	const conn = await mysql.createConnection({
		host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
		user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
	});
	await conn.query("SET FOREIGN_KEY_CHECKS=0");
	const [tables] = await conn.query("SHOW FULL TABLES");
	for (const t of tables) {
		const [name, type] = Object.values(t);
		await conn.query(`DROP ${type === "VIEW" ? "VIEW" : "TABLE"} IF EXISTS \`${name}\``);
	}
	await conn.query("SET FOREIGN_KEY_CHECKS=1");
	await conn.end();
	await migrate();
	await seed();
	await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
