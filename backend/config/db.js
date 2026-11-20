const mysql = require("mysql2/promise");
require("./env");

const pool = mysql.createPool({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER,
	password: process.env.DB_PASS,
	database: process.env.DB_NAME,
	connectionLimit: 10,
	queueLimit: 100,
	charset: "utf8mb4",
	timezone: "Z",
	dateStrings: true,
	decimalNumbers: true,
});

/** Exécute fn(conn) dans une transaction ; commit si OK, rollback sinon. */
async function withTransaction(fn) {
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		const result = await fn(conn);
		await conn.commit();
		return result;
	} catch (err) {
		await conn.rollback().catch(() => {});
		throw err;
	} finally {
		conn.release();
	}
}

module.exports = pool;
module.exports.withTransaction = withTransaction;
