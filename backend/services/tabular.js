// Lecture et écriture CSV / Excel (exceljs). CSV exporté en « ; » avec BOM UTF-8 pour Excel FR ; l'import détecte « ; » ou « , ».
const ExcelJS = require("exceljs");
const { Readable } = require("stream");

function cellValue(v) {
	if (v == null) return "";
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	if (typeof v === "object") {
		if ("result" in v) return cellValue(v.result);
		if ("text" in v) return String(v.text);
		if ("richText" in v) return v.richText.map((t) => t.text).join("");
		return String(v);
	}
	return v;
}

function rowsToObjects(matrix) {
	if (!matrix.length) return [];
	const headers = matrix[0].map((h) => String(cellValue(h)).trim().toLowerCase());
	return matrix.slice(1)
		.filter((r) => r.some((c) => String(cellValue(c)).trim() !== ""))
		.map((r) => Object.fromEntries(headers.map((h, i) => [h, cellValue(r[i])])));
}

/** Lit un fichier CSV ou XLSX → tableau d'objets (clés = en-têtes en minuscules). */
async function readTable(buffer, filename) {
	const lower = (filename || "").toLowerCase();
	if (lower.endsWith(".xlsx")) {
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(buffer);
		const ws = wb.worksheets[0];
		if (!ws) return [];
		const matrix = [];
		ws.eachRow({ includeEmpty: false }, (row) => matrix.push(row.values.slice(1)));
		return rowsToObjects(matrix);
	}
	if (lower.endsWith(".csv")) {
		const text = buffer.toString("utf8").replace(/^﻿/, "");
		const first = text.split(/\r?\n/, 1)[0] || "";
		const delimiter = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
		const wb = new ExcelJS.Workbook();
		const ws = await wb.csv.read(Readable.from([text]), { parserOptions: { delimiter } });
		const matrix = [];
		ws.eachRow({ includeEmpty: false }, (row) => matrix.push(row.values.slice(1)));
		return rowsToObjects(matrix);
	}
	throw new Error("Format non supporté (CSV ou XLSX attendu)");
}

/** Écrit un tableau d'objets en CSV (Buffer) ou XLSX (Buffer). */
async function writeTable(columns, objects, format, sheetName = "Export") {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet(sheetName);
	ws.addRow(columns);
	ws.getRow(1).font = { bold: true };
	// Neutralise l'injection de formules à l'ouverture dans Excel (=, +, -, @ en début de texte).
	const safe = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v ?? "");
	for (const o of objects) ws.addRow(columns.map((c) => safe(o[c])));
	if (format === "xlsx") return Buffer.from(await wb.xlsx.writeBuffer());
	const csv = Buffer.from(await wb.csv.writeBuffer({ formatterOptions: { delimiter: ";" } }));
	return Buffer.concat([Buffer.from("﻿", "utf8"), csv]);
}

module.exports = { readTable, writeTable };
