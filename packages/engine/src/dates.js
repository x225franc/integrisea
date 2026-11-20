// Dates ISO (YYYY-MM-DD) en UTC : résultats identiques quel que soit le fuseau horaire du serveur.
const DAY = 864e5;

const parse = (s) => {
	const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
	if (!y || !m || !d) throw new Error(`Date invalide : ${s}`);
	return Date.UTC(y, m - 1, d);
};
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Années (365,25 j) entre a et b. */
const yearsBetween = (a, b) => (parse(b) - parse(a)) / (365.25 * DAY);
/** Jours entiers entre a et b (négatif si b < a). */
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);

/** Ajoute m mois en conservant le jour (ramené au dernier jour du mois si besoin). */
function addMonths(s, m) {
	const d = new Date(parse(s));
	const day = d.getUTCDate();
	d.setUTCDate(1);
	d.setUTCMonth(d.getUTCMonth() + m);
	const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
	d.setUTCDate(Math.min(day, last));
	return fmt(d.getTime());
}
const addDays = (s, n) => fmt(parse(s) + n * DAY);
const today = () => fmt(Date.now());

module.exports = { yearsBetween, daysBetween, addMonths, addDays, today, parse };
