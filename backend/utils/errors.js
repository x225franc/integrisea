class HttpError extends Error {
	constructor(status, message, details) {
		super(message);
		this.status = status;
		this.details = details;
	}
}

const badRequest = (m, d) => new HttpError(400, m, d);
const unauthorized = (m = "Authentification requise") => new HttpError(401, m);
const forbidden = (m = "Accès refusé") => new HttpError(403, m);
const notFound = (m = "Introuvable") => new HttpError(404, m);
const conflict = (m, d) => new HttpError(409, m, d);

/** Enveloppe un handler async pour transmettre les erreurs à Express. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, wrap };
