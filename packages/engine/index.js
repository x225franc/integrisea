// Moteur de calcul d'intégrité IntegriSea — fonctions pures, sans dépendance, sans E/S.
// ⚠️ Calculs à valider par des ingénieurs intégrité qualifiés avant tout usage opérationnel.
const config = require("./src/config");
const dates = require("./src/dates");
const thickness = require("./src/thickness");
const corrosion = require("./src/corrosion");
const grading = require("./src/grading");
const rbi = require("./src/rbi");
const anomalies = require("./src/anomalies");
const portfolio = require("./src/portfolio");

module.exports = {
	ENGINE_VERSION: "0.3.0",
	...config, ...dates,
	computeTmin: thickness.computeTmin, allowableStressAt: thickness.allowableStressAt,
	computeCmlCorrosion: corrosion.computeCmlCorrosion, corrosionFloor: corrosion.corrosionFloor,
	computeGrade: grading.computeGrade, governingThickness: grading.governingThickness, defaultTemplates: grading.defaultTemplates,
	evaluateAsset: rbi.evaluateAsset, criticality: rbi.criticality, pofFromRemainingLife: rbi.pofFromRemainingLife, defaultPofFor: rbi.defaultPofFor,
	...anomalies,
	...portfolio,
};
