const test = require("node:test");
const assert = require("node:assert/strict");
const { parseStressRows, tableToRows } = require("../services/stressTable");

test("import contraintes : lignes valides → table matériau × température triée, familles reprises", () => {
	const r = parseStressRows([
		{ material: "CS", temp_c: "200", s_mpa: "120,5", family: "carbon" },
		{ material: "CS", temp_c: "-29", s_mpa: 138 },
		{ material: "316L", temp_c: 20, s_mpa: "115", family: "CRA" },
	]);
	assert.deepEqual(r.errors, []);
	assert.deepEqual(r.allowableStress.CS.points, [{ tempC: -29, s: 138 }, { tempC: 200, s: 120.5 }]); // virgule décimale acceptée, tri par température
	assert.deepEqual(r.materialFamilies, { CS: "carbon", "316L": "cra" });
	assert.deepEqual([r.materials, r.points], [2, 3]);
});

test("import contraintes : erreurs signalées avec le numéro de ligne, rien n'est complété", () => {
	const r = parseStressRows([
		{ material: "", temp_c: 20, s_mpa: 100 },
		{ material: "CS", temp_c: "abc", s_mpa: 100 },
		{ material: "CS", temp_c: 20, s_mpa: 0 },
		{ material: "CS", temp_c: 20, s_mpa: 130 },
		{ material: "CS", temp_c: 20, s_mpa: 131 },
		{ material: "CS", temp_c: 50, s_mpa: 120, family: "autre" },
	]);
	assert.deepEqual(r.errors.map((e) => e.line), [2, 3, 4, 6, 7]);
	assert.match(r.errors[3].message, /double/);
	assert.deepEqual(r.allowableStress.CS.points, [{ tempC: 20, s: 130 }]); // seule la ligne valide subsiste
});

test("export contraintes : la table se ré-importe à l'identique", () => {
	const table = { CS: { points: [{ tempC: -29, s: 138 }, { tempC: 200, s: 120 }] } };
	const rows = tableToRows(table, { CS: "carbon" });
	assert.equal(rows.length, 2);
	assert.deepEqual(parseStressRows(rows).allowableStress, table);
});
