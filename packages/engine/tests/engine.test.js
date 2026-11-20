const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../index");

test("le package engine se charge (squelette de l'étape 1)", () => {
	assert.equal(typeof engine.ENGINE_VERSION, "string");
});
