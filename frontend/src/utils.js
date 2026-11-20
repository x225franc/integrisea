/** Nombre arrondi pour l'affichage (null → tiret). */
export const num = (v, d = 2) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : String(Math.round(Number(v) * 10 ** d) / 10 ** d));

export const RISK_CLASS = { L: 'risk-L', M: 'risk-M', MH: 'risk-MH', H: 'risk-H' };
export const STATUS_CLASS = { overdue: 'text-bg-danger', due_soon: 'text-bg-warning', planned: 'text-bg-success', unknown: 'text-bg-secondary' };
export const PRIORITY_CLASS = { P1: 'text-bg-danger', P2: 'text-bg-warning', P3: 'text-bg-info', P4: 'text-bg-secondary' };
export const AN_STATUS_CLASS = { Open: 'text-bg-primary', InProgress: 'text-bg-warning', Closed: 'text-bg-secondary' };

/** Nom de fichier proposé à partir d'un titre. */
export const slug = (s) => String(s).replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
