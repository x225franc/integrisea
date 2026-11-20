const { z } = require("./validate");

/** Date ISO AAAA-MM-JJ réelle (rejette 2026-02-30). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ attendue").refine((s) => {
	const d = new Date(s + "T00:00:00Z");
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Date invalide");

module.exports = { isoDate };
