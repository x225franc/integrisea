const { yearsBetween } = require("./dates");

const normId = (v) => String(v ?? "").trim().toUpperCase();

/**
 * Regroupe les relevés de toutes les inspections PAR CML (point de mesure) : { id, points:[{date,t}] triés par date }.
 * On ne compare JAMAIS le minimum d'une inspection au minimum d'une autre : ce seraient des emplacements différents.
 * Un relevé sans identifiant de CML (nombre seul) reçoit l'identifiant positionnel « #n ». Deux relevés du même CML
 * à la même date : on garde le plus faible (conservateur).
 */
function groupByCml(inspections) {
	const map = new Map();
	for (const insp of inspections) {
		(insp.readings || []).forEach((r, i) => {
			const t = Number(r?.t ?? r);
			if (!Number.isFinite(t) || !(t > 0)) return;
			const id = normId(r?.cml) || `#${i + 1}`;
			const pts = map.get(id) || map.set(id, []).get(id);
			const same = pts.find((p) => p.date === insp.date);
			if (same) same.t = Math.min(same.t, t); else pts.push({ date: insp.date, t });
		});
	}
	return [...map.entries()]
		.map(([id, points]) => ({ id, points: points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) }))
		.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** Plancher de vitesse de corrosion selon la famille du matériau ; matériau inconnu → acier carbone (conservateur). */
function corrosionFloor(material, config) {
	const known = config.materialFamilies?.[material];
	const family = known ?? "carbon";
	return { family, known: !!known, floor: config.corrosionFloors[family] };
}

/**
 * Vitesse de corrosion et durée de vie résiduelle POUR CHAQUE CML.
 *  - épaisseur de référence t_ref : la première mesure du CML si le CML a au moins deux mesures ;
 *    sinon (une seule mesure) l'épaisseur nominale à compter du 1er juillet de l'année d'installation.
 *    Un CML à une seule mesure et sans nominal/année d'installation n'a pas de référence : il ne sert qu'à l'inspection suivante.
 *  - long terme  : (t_réf − t_dernière) / durée depuis la référence (durée minimale minLongTermYears)
 *  - court terme : (t_avant-dernière − t_dernière) / durée entre les deux dernières mesures du CML (si ≥ 2 mesures ; minShortTermYears)
 *  - CR_CML = max(long terme, court terme, plancher de la famille de matériau)
 *  - RL_CML = (t_dernière − t_min) / CR_CML − années écoulées depuis la mesure (nécessite t_min)
 * RL de l'actif = plus faible RL_CML ; ce CML est le « CML gouvernant ».
 *
 * Retourne { cmls[], governing, baseDate, lines[] } ; cmls[i] = { id, points, tLast, lastDate, tRef, refDate, refKind,
 * crLT, crST, cr, floor, family, floored, rlAtLast, rlRaw, rl, usable }.
 */
function computeCmlCorrosion(asset, inspections, tmin, config, todayIso) {
	const lines = [];
	const { family, floor, known } = corrosionFloor(asset.material, config);
	const groups = groupByCml(inspections);
	const cmls = [];
	let baseDate = null;

	for (const g of groups) {
		const pts = g.points;
		const last = pts[pts.length - 1];
		if (!baseDate || last.date > baseDate) baseDate = last.date;
		const c = { id: g.id, points: pts, tLast: last.t, lastDate: last.date, family, floor, usable: false };

		let ref = null;
		if (pts.length >= 2) ref = { t: pts[0].t, date: pts[0].date, kind: "first" };
		else if (asset.installYear && asset.nominalThicknessMm > 0) ref = { t: asset.nominalThicknessMm, date: `${asset.installYear}-07-01`, kind: "nominal" };
		if (!ref) { cmls.push(c); lines.push({ code: "cml_no_reference", params: { cml: g.id, tLast: last.t } }); continue; }

		c.tRef = ref.t; c.refDate = ref.date; c.refKind = ref.kind;
		const yLT = Math.max(yearsBetween(ref.date, last.date), config.minLongTermYears);
		c.crLT = Math.max(0, (ref.t - last.t) / yLT);
		if (pts.length >= 2) {
			const prev = pts[pts.length - 2];
			const yST = Math.max(yearsBetween(prev.date, last.date), config.minShortTermYears);
			c.crST = Math.max(0, (prev.t - last.t) / yST);
		}
		const raw = Math.max(c.crLT, c.crST ?? 0);
		c.cr = Math.max(raw, floor);
		c.floored = c.cr > raw;
		c.usable = true;
		if (tmin !== null && tmin !== undefined) {
			c.rlAtLast = (last.t - tmin) / c.cr;
			const since = Math.max(0, yearsBetween(last.date, todayIso));
			c.since = since;
			c.rlRaw = c.rlAtLast - since;
			c.rl = Math.max(0, c.rlRaw);
		}
		cmls.push(c);
	}

	let governing = null;
	const rated = cmls.filter((c) => c.usable && c.rlRaw !== undefined);
	if (rated.length) governing = rated.reduce((a, b) => (b.rlRaw < a.rlRaw || (b.rlRaw === a.rlRaw && b.tLast < a.tLast) ? b : a)).id;
	const usable = cmls.filter((c) => c.usable);
	if (governing === null && usable.length) governing = usable.reduce((a, b) => (b.cr > a.cr ? b : a)).id; // sans t_min : plus forte vitesse

	for (const c of cmls) {
		if (!c.usable) continue;
		lines.push({
			code: "corrosion_cml",
			params: {
				cml: c.id, measurements: c.points.length, refKind: c.refKind, tRef: c.tRef, refDate: c.refDate, tLast: c.tLast, lastDate: c.lastDate,
				crLT: c.crLT, crST: c.crST ?? null, cr: c.cr, floor: c.floor, family: c.family, floored: c.floored, familyKnown: known,
				rlAtLast: c.rlAtLast ?? null, rlRaw: c.rlRaw ?? null, governing: c.id === governing,
			},
		});
	}
	return { cmls, governing, baseDate, familyKnown: known, lines };
}

module.exports = { computeCmlCorrosion, groupByCml, corrosionFloor };
