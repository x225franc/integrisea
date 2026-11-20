const { z } = require("zod");
const { badRequest } = require("./errors");

/** Valide `data` avec un schéma zod ; lève une 400 lisible sinon. */
function parse(schema, data) {
	const r = schema.safeParse(data);
	if (!r.success) {
		throw badRequest(
			"Données invalides",
			r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
		);
	}
	return r.data;
}

const emptyToNull = (v) => (v === "" || v === undefined ? null : v);
const optStr = (max) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();
const optNum = (min, max) => z.preprocess(emptyToNull, z.coerce.number().min(min).max(max).nullable()).optional();
const optInt = (min, max) => z.preprocess(emptyToNull, z.coerce.number().int().min(min).max(max).nullable()).optional();

const password = z.string().min(10, "10 caractères minimum").max(128);

module.exports = { z, parse, optStr, optNum, optInt, password };
