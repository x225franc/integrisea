// Sélection explicite pour tester la configuration de production en local.
process.env.NODE_ENV = "production";
process.env.ENV_FILE = process.env.ENV_FILE ?? ".env.production";
require("../api");
