// Stockage des fichiers : disque local (développement) ou S3 compatible (MinIO, RustFS, AWS…) selon STORAGE_DRIVER.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../config/db");

const driver = () => (process.env.STORAGE_DRIVER || "local").toLowerCase();
const localDir = () => path.resolve(__dirname, "../uploads");

let s3 = null;
function s3Client() {
	if (s3) return s3;
	const { S3Client } = require("@aws-sdk/client-s3");
	s3 = new S3Client({
		region: process.env.S3_REGION || "us-east-1",
		endpoint: process.env.S3_ENDPOINT,
		forcePathStyle: true, // exigé par MinIO et la plupart des serveurs S3 auto-hébergés
		credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
	});
	return s3;
}

/** Crée le bucket s'il n'existe pas (S3 uniquement). À appeler au démarrage. */
async function init() {
	if (driver() === "s3") {
		const { HeadBucketCommand, CreateBucketCommand } = require("@aws-sdk/client-s3");
		const Bucket = process.env.S3_BUCKET;
		try { await s3Client().send(new HeadBucketCommand({ Bucket })); } catch { await s3Client().send(new CreateBucketCommand({ Bucket })); }
	} else {
		fs.mkdirSync(localDir(), { recursive: true });
	}
}

const safeName = (n) => String(n || "file").replace(/[^\w.\- ()]/g, "_").slice(0, 200);

/** Enregistre un fichier ; retourne la ligne `files` créée. La clé de stockage est aléatoire (jamais dérivée du nom client). */
async function put(buffer, { name, mime, userId }) {
	const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}`;
	if (driver() === "s3") {
		const { PutObjectCommand } = require("@aws-sdk/client-s3");
		await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: mime }));
	} else {
		const p = path.join(localDir(), key);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, buffer);
	}
	const sha = crypto.createHash("sha256").update(buffer).digest("hex");
	const [r] = await db.query("INSERT INTO files (storage_key, original_name, mime, size_bytes, sha256, uploaded_by) VALUES (?,?,?,?,?,?)",
		[key, safeName(name), mime, buffer.length, sha, userId ?? null]);
	return { id: r.insertId, key, name: safeName(name), mime, size: buffer.length, sha256: sha };
}

async function read(fileRow) {
	if (driver() === "s3") {
		const { GetObjectCommand } = require("@aws-sdk/client-s3");
		const r = await s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: fileRow.storage_key }));
		return Buffer.from(await r.Body.transformToByteArray());
	}
	const p = path.resolve(localDir(), fileRow.storage_key);
	if (!p.startsWith(localDir() + path.sep)) throw new Error("Chemin de stockage invalide");
	return fs.readFileSync(p);
}

// Types acceptés, contrôlés sur les premiers octets (pas seulement sur l'extension ou l'en-tête du client).
const SIGNATURES = [
	{ mime: "application/pdf", ext: [".pdf"], test: (b) => b.slice(0, 5).toString() === "%PDF-" },
	{ mime: "image/png", ext: [".png"], test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
	{ mime: "image/jpeg", ext: [".jpg", ".jpeg"], test: (b) => b[0] === 0xff && b[1] === 0xd8 },
	{ mime: "image/webp", ext: [".webp"], test: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" },
	{ mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: [".docx"], test: (b) => b.slice(0, 2).toString() === "PK" },
	{ mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: [".xlsx"], test: (b) => b.slice(0, 2).toString() === "PK" },
];

/** Retourne le type MIME vérifié, ou null si le fichier n'est pas accepté. */
function sniff(buffer, filename) {
	const ext = path.extname(filename || "").toLowerCase();
	const sig = SIGNATURES.find((s) => s.ext.includes(ext));
	return sig && buffer.length > 12 && sig.test(buffer) ? sig.mime : null;
}

module.exports = { init, put, read, sniff, safeName };
