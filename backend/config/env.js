const dotenv = require("dotenv");
const { resolve } = require("path");

const root = resolve(__dirname, "../..");
const mode = process.env.NODE_ENV || process.env.ENV || "development";
const file = process.env.ENV_FILE ?? (mode === "production" ? ".env.production" : ".env.development");

// Les variables fournies par l'hébergement / Docker restent prioritaires (dotenv n'écrase pas).
if (file) dotenv.config({ path: resolve(root, file) });
dotenv.config({ path: resolve(root, ".env") });

const isProd = mode === "production";

// En production, refuse de démarrer avec des secrets absents ou laissés au placeholder.
function assertProductionConfig() {
	if (!isProd) return;
	const required = ["DB_HOST", "DB_USER", "DB_PASS", "DB_NAME", "JWT_SECRET", "FRONTEND_URL"];
	const bad = required.filter((k) => !process.env[k] || /change_me/i.test(process.env[k]));
	if (bad.length) {
		console.error(`Configuration production invalide (valeurs manquantes ou "change_me") : ${bad.join(", ")}`);
		process.exit(1);
	}
	if (process.env.JWT_SECRET.length < 32) {
		console.error("JWT_SECRET doit contenir au moins 32 caractères en production.");
		process.exit(1);
	}
}

module.exports = { isProd, assertProductionConfig };
