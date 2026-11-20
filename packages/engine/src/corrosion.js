const { yearsBetween } = require("./dates");

/**
 * Vitesses de corrosion (mm/an) à partir des relevés d'épaisseur.
 * series = [{ date, t }] où t = plus faible épaisseur relevée lors de l'inspection (CML gouvernant).
 *  - long terme  : (t_nom − t_dernière) / années depuis l'installation (1er juillet de l'année d'installation)
 *  - court terme : (t_avant-dernière − t_dernière) / années entre les deux dernières mesures (si ≥ 2 mesures)
 * On retient la plus élevée, avec un minimum configurable. Une seule mesure : vitesse long terme seule.
 * Une vitesse négative (épaisseur qui « augmente ») est ramenée à 0 puis au minimum.
 */
function computeCorrosion(asset, series, config) {
	const s = [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	if (!s.length) return { ok: false, lines: [] };
	const last = s[s.length - 1];
	const out = { ok: true, tLast: last.t, tLastDate: last.date, series: s, lines: [] };

	if (asset.installYear && asset.nominalThicknessMm > 0) {
		const yrs = Math.max(yearsBetween(`${asset.installYear}-07-01`, last.date), config.minLongTermYears);
		out.crLT = Math.max(0, (asset.nominalThicknessMm - last.t) / yrs);
	}
	if (s.length > 1) {
		const prev = s[s.length - 2];
		const yrs = Math.max(yearsBetween(prev.date, last.date), config.minShortTermYears);
		out.crST = Math.max(0, (prev.t - last.t) / yrs);
	}
	const candidates = [out.crLT, out.crST].filter((v) => v !== undefined);
	const raw = candidates.length ? Math.max(...candidates) : 0;
	out.cr = Math.max(raw, config.minCorrosionRate);
	out.crFloored = out.cr > raw;
	out.lines.push({ code: "corrosion", params: { crLT: out.crLT ?? null, crST: out.crST ?? null, cr: out.cr, measurements: s.length, floored: out.crFloored } });
	return out;
}

module.exports = { computeCorrosion };
