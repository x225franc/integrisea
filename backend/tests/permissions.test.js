const test = require("node:test");
const assert = require("node:assert/strict");
const { hasRole, roleOn, facilityIdsWithRole } = require("../services/permissions");

const admin = { isAdmin: true, facilityRoles: {} };
const user = { isAdmin: false, facilityRoles: { 1: "reader", 2: "engineer", 3: "inspector" } };

test("l'administrateur a tous les droits partout", () => {
	assert.equal(roleOn(admin, 99), "admin");
	assert.ok(hasRole(admin, 99, "engineer"));
	assert.equal(facilityIdsWithRole(admin), null);
});

test("les droits sont par installation et hiérarchiques", () => {
	assert.ok(hasRole(user, 1, "reader"));
	assert.ok(!hasRole(user, 1, "inspector"));
	assert.ok(hasRole(user, 2, "inspector"));
	assert.ok(hasRole(user, 2, "engineer"));
	assert.ok(hasRole(user, 3, "reader"));
	assert.ok(!hasRole(user, 3, "engineer"));
});

test("aucun droit sur une installation non attribuée", () => {
	assert.equal(roleOn(user, 4), null);
	assert.ok(!hasRole(user, 4, "reader"));
	assert.ok(!hasRole(null, 1, "reader"));
});

test("facilityIdsWithRole filtre selon le rôle minimal", () => {
	assert.deepEqual(facilityIdsWithRole(user).sort(), [1, 2, 3]);
	assert.deepEqual(facilityIdsWithRole(user, "engineer"), [2]);
	assert.deepEqual(facilityIdsWithRole({ isAdmin: false, facilityRoles: {} }, "reader"), []);
});
