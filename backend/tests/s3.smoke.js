// Test du stockage S3 contre un vrai serveur (service Docker « s3 » : npm run docker:storage).
// Usage : STORAGE_DRIVER=s3 node backend/tests/s3.smoke.js — hors `npm test` (nécessite Docker et MySQL).
process.env.STORAGE_DRIVER = "s3";
require("../config/env");
process.env.STORAGE_DRIVER = "s3";
const crypto = require("crypto");
const db = require("../config/db");
const storage = require("../services/storage");

(async () => {
	console.log("endpoint:", process.env.S3_ENDPOINT, "bucket:", process.env.S3_BUCKET);
	await storage.init();
	console.log("✔ bucket prêt (créé si absent)");
	await storage.init();
	console.log("✔ init idempotent");
	const payload = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(2048)]);
	const f = await storage.put(payload, { name: "essai.pdf", mime: "application/pdf", userId: null });
	console.log("✔ fichier envoyé", f.key);
	const [[row]] = await db.query("SELECT * FROM files WHERE id = ?", [f.id]);
	const back = await storage.read(row);
	if (!back.equals(payload)) throw new Error("contenu relu différent de l'original");
	console.log("✔ contenu relu identique (" + back.length + " octets, sha256 " + row.sha256.slice(0, 12) + "…)");
	await db.query("DELETE FROM files WHERE id = ?", [f.id]);
	await db.end();
})().catch((e) => { console.error("✖", e.name, e.message); process.exit(1); });
