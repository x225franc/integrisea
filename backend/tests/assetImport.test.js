const test = require("node:test");
const assert = require("node:assert/strict");
const { parseImportRows, toExportRow, COLUMNS } = require("../services/assetImport");
const { readTable, writeTable } = require("../services/tabular");
const { diff } = require("../services/audit");

const lookups = {
	systemsByCode: new Map([["AUR-M10", { id: 1, facility_id: 10 }], ["WHA-TOP", { id: 2, facility_id: 20 }]]),
	classCodes: new Set(["PIPE", "PV"]),
};

test("une ligne valide est convertie (types, classe en majuscules, mécanismes)", () => {
	const { rows, errors } = parseImportRows([{
		tag: " 10-PL-1 ", system: "AUR-M10", class: "pipe", description: "Ligne", od_mm: "168,3".replace(",", "."),
		nominal_thickness_mm: "7.11", install_year: "2014", degradation_mechanisms: "CO2 corrosion| CUI ", crit_s: "", design_pressure_barg: "",
	}], lookups);
	assert.deepEqual(errors, []);
	assert.equal(rows.length, 1);
	const r = rows[0];
	assert.equal(r.facilityId, 10);
	assert.equal(r.data.tag, "10-PL-1");
	assert.equal(r.data.class_code, "PIPE");
	assert.equal(r.data.system_id, 1);
	assert.equal(r.data.od_mm, 168.3);
	assert.equal(r.data.design_pressure_barg, null);
	assert.deepEqual(r.data.degradation_mechanisms, ["CO2 corrosion", "CUI"]);
});

test("les erreurs sont rapportées avec leur numéro de ligne", () => {
	const { rows, errors } = parseImportRows([
		{ tag: "A", system: "INCONNU", class: "PIPE", description: "x" },
		{ tag: "B", system: "AUR-M10", class: "ZZZ", description: "x" },
		{ tag: "C", system: "AUR-M10", class: "PIPE", description: "" },
		{ tag: "D", system: "AUR-M10", class: "PIPE", description: "x", crit_s: "9" },
	], lookups);
	assert.equal(rows.length, 0);
	assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 5]);
	assert.match(errors[0].message, /Système inconnu/);
	assert.match(errors[1].message, /Classe inconnue/);
});

test("un tag en double dans le fichier est refusé (insensible à la casse)", () => {
	const base = { system: "AUR-M10", class: "PIPE", description: "x" };
	const { rows, errors } = parseImportRows([{ ...base, tag: "T1" }, { ...base, tag: "t1" }], lookups);
	assert.equal(rows.length, 1);
	assert.equal(errors.length, 1);
	assert.match(errors[0].message, /double/);
});

test("export → import : aller-retour CSV et XLSX sans perte", async () => {
	const asset = {
		tag: "T-1", system_code: "AUR-M10", class_code: "PV", description: 'Séparateur "HP"; test', fluid: "Crude oil", material: "CS",
		design_pressure_barg: 45, design_temp_c: -10, od_mm: 3000, nominal_thickness_mm: 60, install_year: 2014,
		degradation_mechanisms: JSON.stringify(["CO2 corrosion", "Erosion"]), crit_s: 4, crit_e: null, crit_p: null,
	};
	for (const fmt of ["csv", "xlsx"]) {
		const buf = await writeTable(COLUMNS, [toExportRow(asset)], fmt);
		const raw = await readTable(buf, `x.${fmt}`);
		const { rows, errors } = parseImportRows(raw, lookups);
		assert.deepEqual(errors, [], fmt);
		assert.equal(rows[0].data.description, 'Séparateur "HP"; test', fmt);
		assert.equal(rows[0].data.design_temp_c, -10, fmt);
		assert.deepEqual(rows[0].data.degradation_mechanisms, ["CO2 corrosion", "Erosion"], fmt);
		assert.equal(rows[0].data.crit_s, 4, fmt);
	}
});

test("l'import CSV accepte « , » comme séparateur", async () => {
	const raw = await readTable(Buffer.from("tag,system,class,description\nA,AUR-M10,PIPE,ok\n"), "a.csv");
	assert.equal(raw[0].tag, "A");
});

test("l'export neutralise l'injection de formules", async () => {
	const buf = await writeTable(["tag", "description"], [{ tag: "=CMD()", description: "@x" }], "csv");
	const text = buf.toString("utf8");
	assert.ok(text.includes("'=CMD()"));
	assert.ok(text.includes("'@x"));
});

test("diff ne retient que les champs modifiés", () => {
	const d = diff({ a: 1, b: [1], c: null }, { a: 1, b: [1, 2], c: null });
	assert.ok(d.changed);
	assert.deepEqual(d.before, { b: [1] });
	assert.deepEqual(d.after, { b: [1, 2] });
	assert.equal(diff({ a: 1 }, { a: 1 }).changed, false);
});
