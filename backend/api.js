const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { assertProductionConfig, isProd } = require("./config/env");
assertProductionConfig();
const db = require("./config/db");
const { HttpError } = require("./utils/errors");

if (!process.env.JWT_SECRET) {
	console.error("Erreur : JWT_SECRET n'est pas défini (voir .env.development.example).");
	process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(helmet());

// Proxy de confiance pour lire la vraie IP client (limiteurs de débit, audit).
const trustProxy = process.env.TRUST_PROXY ?? "loopback";
app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === "false" ? false : trustProxy);

const origins = [process.env.FRONTEND_URL, ...(process.env.CORS_ORIGINS || "").split(",")].map((s) => s && s.trim()).filter(Boolean);
app.use(cors({
	origin: origins,
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization"],
	credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

// Configuration publique (aucun secret).
app.get("/api/config", (_req, res) => {
	res.json({ env: isProd ? "production" : "development", showValidationWarning: process.env.SHOW_VALIDATION_WARNING !== "false" });
});
app.get("/api/health", async (_req, res) => {
	try { await db.query("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/users", require("./routes/users.routes"));
app.use("/api/assets", require("./routes/assets.routes"));
app.use("/api/audit", require("./routes/audit.routes"));
app.use("/api/inspections", require("./routes/inspections.routes"));
app.use("/api/anomalies", require("./routes/anomalies.routes"));
app.use("/api/rbi", require("./routes/rbi.routes"));
app.use("/api/settings", require("./routes/settings.routes"));
app.use("/api/maintenance", require("./routes/maintenance.routes"));
app.use("/api/materials", require("./routes/materials.routes"));
app.use("/api/documents", require("./routes/documents.routes"));
app.use("/api/files", require("./routes/documents.routes").filesRouter);
app.use("/api/export", require("./routes/export.routes"));
app.use("/api", require("./routes/facilities.routes"));
app.use("/api", require("./routes/classes.routes"));

app.use("/api", (_req, res) => res.status(404).json({ message: "Route introuvable" }));

// Gestionnaire d'erreurs : jamais de détail interne vers le client.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
	if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, details: err.details });
	if (err?.name === "MulterError") return res.status(400).json({ message: "Fichier invalide ou trop volumineux" });
	if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "JSON invalide" });
	console.error(err);
	res.status(500).json({ message: "Erreur interne du serveur" });
});

const port = Number(process.env.BACKEND_PORT || 4000);
if (require.main === module) {
	const storage = require("./services/storage");
	const risk = require("./services/risk");
	storage.init().catch((e) => console.error("Stockage de fichiers indisponible :", e.message));
	// Les échéances dépendent de la date : recalcul au démarrage puis toutes les 6 h (en plus des recalculs à chaque changement).
	const refresh = () => risk.ensureFresh().catch((e) => console.error("Recalcul des risques :", e.message));
	setTimeout(refresh, 1500);
	setInterval(refresh, 6 * 3600 * 1000).unref();
	app.listen(port, () => console.log(`IntegriSea API (${isProd ? "production" : "development"}) sur le port ${port}`));
}

module.exports = app;
