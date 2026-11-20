// Génération de documents : rapport d'inspection (PDF), document de stratégie de maintenance (PDF et Word).
const PDFDocument = require("pdfkit");
const docx = require("docx");

const T = {
	fr: {
		warning: "Calculs non validés : à faire valider par des ingénieurs intégrité qualifiés avant toute utilisation opérationnelle.",
		inspReport: "Rapport d'inspection", asset: "Actif", facility: "Installation", system: "Système", class: "Classe", template: "Gabarit",
		date: "Date", inspector: "Inspecteur", results: "Résultats", readings: "Relevés d'épaisseur (mm)", cml: "CML", grade: "Grade (1 bon – 4 mauvais)",
		notes: "Observations", assessment: "Évaluation du risque", pof: "PoF", cof: "CoF", risk: "Risque", nextDue: "Prochaine inspection", interval: "Intervalle (mois)",
		rl: "Durée de vie résiduelle (ans)", tmin: "t_min (mm)", cr: "Vitesse de corrosion (mm/an)", generated: "Généré le", ref: "Référence",
		strategy: "Stratégie de maintenance", failureMode: "Mode de défaillance", mechanism: "Mécanisme", effect: "Effet", task: "Tâche", method: "Méthode",
		intervalCol: "Intervalle", discipline: "Discipline", rbi: "RBI", months: "mois", assetsOfClass: "Actifs concernés", tag: "Tag", all: "Toutes les classes",
		yes: "Oui", no: "Non", pass: "Conforme", fail: "Non conforme",
	},
	en: {
		warning: "Unvalidated calculations: must be validated by qualified integrity engineers before any operational use.",
		inspReport: "Inspection report", asset: "Asset", facility: "Facility", system: "System", class: "Class", template: "Template",
		date: "Date", inspector: "Inspector", results: "Results", readings: "Thickness readings (mm)", cml: "CML", grade: "Grade (1 good – 4 poor)",
		notes: "Findings", assessment: "Risk assessment", pof: "PoF", cof: "CoF", risk: "Risk", nextDue: "Next inspection", interval: "Interval (months)",
		rl: "Remaining life (years)", tmin: "t_min (mm)", cr: "Corrosion rate (mm/y)", generated: "Generated on", ref: "Reference",
		strategy: "Maintenance strategy", failureMode: "Failure mode", mechanism: "Mechanism", effect: "Effect", task: "Task", method: "Method",
		intervalCol: "Interval", discipline: "Discipline", rbi: "RBI", months: "months", assetsOfClass: "Assets covered", tag: "Tag", all: "All classes",
		yes: "Yes", no: "No", pass: "Pass", fail: "Fail",
	},
};
const tr = (lang) => T[lang] || T.fr;

function pdfToBuffer(build) {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ size: "A4", margin: 48, info: { Producer: "IntegriSea" } });
		const chunks = [];
		doc.on("data", (c) => chunks.push(c));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);
		build(doc);
		doc.end();
	});
}

const kv = (doc, k, v) => { doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text(k, { continued: true }).font("Helvetica").fillColor("#000").text("  " + (v ?? "—")); };
const h2 = (doc, s) => { doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).fillColor("#0b2a45").text(s).moveDown(0.3).fillColor("#000"); };

/** Rapport d'inspection. data = { inspection, asset, template, evaluation, lang, showWarning } */
function inspectionReportPdf({ inspection, asset, template, evaluation, lang = "fr", showWarning = true }) {
	const L = tr(lang);
	return pdfToBuffer((doc) => {
		doc.font("Helvetica-Bold").fontSize(18).fillColor("#0b2a45").text("IntegriSea");
		doc.font("Helvetica").fontSize(14).fillColor("#000").text(`${L.inspReport} — ${inspection.reference}`);
		if (showWarning) doc.moveDown(0.3).fontSize(8).fillColor("#9a6700").text(L.warning).fillColor("#000");
		h2(doc, L.asset);
		kv(doc, `${L.asset} :`, `${asset.tag} — ${asset.description}`);
		kv(doc, `${L.facility} :`, asset.facility_name); kv(doc, `${L.system} :`, asset.system_name); kv(doc, `${L.class} :`, asset.class_code);
		kv(doc, `${L.template} :`, template.name); kv(doc, `${L.date} :`, String(inspection.performed_on).slice(0, 10)); kv(doc, `${L.inspector} :`, inspection.inspector);

		h2(doc, L.results);
		const data = inspection.data || {};
		for (const f of template.fields) {
			if (f.t === "cml") continue;
			let v = data[f.k];
			if (f.t === "pf") v = v === "Pass" ? L.pass : v === "Fail" ? L.fail : v;
			if (v !== undefined && v !== "") kv(doc, `${f.l} :`, String(v));
		}
		if (inspection.readings?.length) {
			doc.moveDown(0.4).font("Helvetica-Bold").fontSize(10).text(L.readings);
			doc.font("Helvetica").fontSize(9).text(inspection.readings.map((r) => `${r.cml}: ${r.t}`).join("   "));
		}
		if (inspection.grade) kv(doc, `${L.grade} :`, inspection.grade);
		if (inspection.notes) { doc.moveDown(0.4); kv(doc, `${L.notes} :`, inspection.notes); }

		if (evaluation) {
			h2(doc, L.assessment);
			kv(doc, `${L.pof} / ${L.cof} :`, `${evaluation.pof} / ${evaluation.cof}`);
			kv(doc, `${L.risk} :`, evaluation.risk);
			if (evaluation.tmin != null) kv(doc, `${L.tmin} :`, evaluation.tmin);
			if (evaluation.cr != null) kv(doc, `${L.cr} :`, evaluation.cr.toFixed(3));
			if (evaluation.rl != null) kv(doc, `${L.rl} :`, evaluation.rl.toFixed(1));
			kv(doc, `${L.interval} :`, evaluation.intervalMonths);
			kv(doc, `${L.nextDue} :`, evaluation.dueDate);
		}
		doc.moveDown(2).fontSize(8).fillColor("#777").text(`${L.generated} ${new Date().toISOString().slice(0, 10)}`);
	});
}

/** Lignes de stratégie : [{ class_code, failure_mode, mechanism, effect, task, method, interval_months, discipline }]. */
function strategyPdf({ title, rows, assetsByClass, lang = "fr", showWarning = true }) {
	const L = tr(lang);
	return pdfToBuffer((doc) => {
		doc.font("Helvetica-Bold").fontSize(18).fillColor("#0b2a45").text("IntegriSea");
		doc.font("Helvetica").fontSize(14).fillColor("#000").text(`${L.strategy} — ${title}`);
		if (showWarning) doc.moveDown(0.3).fontSize(8).fillColor("#9a6700").text(L.warning).fillColor("#000");
		const classes = [...new Set(rows.map((r) => r.class_code))];
		for (const c of classes) {
			h2(doc, `${c}`);
			const tags = assetsByClass?.[c] || [];
			if (tags.length) doc.font("Helvetica").fontSize(8).fillColor("#555").text(`${L.assetsOfClass} (${tags.length}) : ${tags.join(", ")}`).fillColor("#000").moveDown(0.3);
			for (const r of rows.filter((x) => x.class_code === c)) {
				doc.font("Helvetica-Bold").fontSize(10).text(`${r.failure_mode} — ${r.mechanism ?? ""}`);
				doc.font("Helvetica").fontSize(9).text(`${L.effect} : ${r.effect ?? "—"}`);
				doc.text(`${L.task} : ${r.task}  |  ${L.method} : ${r.method ?? "—"}  |  ${L.intervalCol} : ${r.interval_months == null ? L.rbi : `${r.interval_months} ${L.months}`}  |  ${L.discipline} : ${r.discipline ?? "—"}`);
				doc.moveDown(0.4);
				if (doc.y > 750) doc.addPage();
			}
		}
	});
}

async function strategyDocx({ title, rows, assetsByClass, lang = "fr", showWarning = true }) {
	const L = tr(lang);
	const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType } = docx;
	const cell = (t, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(t ?? "—"), bold, size: 18 })] })] });
	const children = [new Paragraph({ text: `IntegriSea — ${L.strategy}`, heading: HeadingLevel.TITLE }), new Paragraph({ text: title })];
	if (showWarning) children.push(new Paragraph({ children: [new TextRun({ text: L.warning, italics: true, color: "9A6700", size: 18 })] }));
	for (const c of [...new Set(rows.map((r) => r.class_code))]) {
		children.push(new Paragraph({ text: c, heading: HeadingLevel.HEADING_1 }));
		const tags = assetsByClass?.[c] || [];
		if (tags.length) children.push(new Paragraph({ children: [new TextRun({ text: `${L.assetsOfClass} (${tags.length}) : ${tags.join(", ")}`, size: 16, color: "555555" })] }));
		children.push(new Table({
			width: { size: 100, type: WidthType.PERCENTAGE },
			rows: [
				new TableRow({ children: [L.failureMode, L.mechanism, L.effect, L.task, L.method, L.intervalCol, L.discipline].map((h) => cell(h, true)) }),
				...rows.filter((r) => r.class_code === c).map((r) => new TableRow({ children: [
					cell(r.failure_mode), cell(r.mechanism), cell(r.effect), cell(r.task), cell(r.method),
					cell(r.interval_months == null ? L.rbi : `${r.interval_months} ${L.months}`), cell(r.discipline),
				] })),
			],
		}));
	}
	return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

module.exports = { inspectionReportPdf, strategyPdf, strategyDocx };
