<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Courbe d'épaisseur : relevés (plus faible CML), nominale, t_min et projection à la vitesse retenue.
const props = defineProps({
	series: { type: Array, default: () => [] }, // [{ date, t }]
	nominal: Number, tmin: Number, rate: Number, installYear: Number,
});
const { t } = useI18n();
const W = 620, H = 230, pl = 48, pr = 16, pt = 14, pb = 32;
const ms = (d) => new Date(d + 'T00:00:00Z').getTime();
const YEAR = 365.25 * 864e5;

const model = computed(() => {
	if (!props.series.length) return null;
	const pts = props.series.map((p) => ({ x: ms(p.date), t: p.t, d: p.date }));
	const last = pts[pts.length - 1];
	const x0 = props.installYear ? Date.UTC(props.installYear, 6, 1) : pts[0].x;
	// Projection : jusqu'à atteindre t_min (ou 25 ans maximum), bornée pour rester lisible.
	let proj = null;
	if (props.rate > 0 && props.tmin != null) {
		const yrs = Math.min(25, Math.max(2, (last.t - props.tmin) / props.rate));
		proj = { x1: last.x + yrs * YEAR, t1: last.t - props.rate * yrs };
	}
	const x1 = Math.max(last.x, proj?.x1 ?? last.x, Date.now());
	const ys = [props.nominal, props.tmin, ...pts.map((p) => p.t), proj?.t1].filter((v) => Number.isFinite(v));
	const lo = Math.min(...ys), hi = Math.max(...ys);
	const pad = (hi - lo || 1) * 0.12;
	const y0 = Math.max(0, lo - pad), y1 = hi + pad;
	const X = (v) => pl + ((v - x0) / (x1 - x0)) * (W - pl - pr);
	const Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
	const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
	const yrFrom = new Date(x0).getUTCFullYear(), yrTo = new Date(x1).getUTCFullYear();
	const step = Math.max(1, Math.ceil((yrTo - yrFrom) / 6));
	const xTicks = [];
	for (let y = yrFrom; y <= yrTo; y += step) xTicks.push({ y, x: X(Date.UTC(y, 0, 1)) });
	return {
		line: pts.map((p) => `${X(p.x)},${Y(p.t)}`).join(' '),
		dots: pts.map((p) => ({ cx: X(p.x), cy: Y(p.t), d: p.d, t: p.t })),
		projLine: proj ? { x1: X(last.x), y1: Y(last.t), x2: X(proj.x1), y2: Y(proj.t1) } : null,
		tminY: props.tmin != null ? Y(props.tmin) : null, nomY: props.nominal != null ? Y(props.nominal) : null,
		yTicks: yTicks.map((v) => ({ v, y: Y(v) })), xTicks,
	};
});
</script>

<template>
	<div v-if="model">
		<svg :viewBox="`0 0 ${W} ${H}`" class="w-100" role="img" :aria-label="t('rbi.thickness')">
			<g class="grid">
				<g v-for="g in model.yTicks" :key="g.v"><line :x1="pl" :x2="W - pr" :y1="g.y" :y2="g.y" stroke="#e5ebf0" /><text :x="pl - 6" :y="g.y + 4" text-anchor="end" font-size="10" fill="#5b7285">{{ g.v.toFixed(1) }}</text></g>
				<text v-for="g in model.xTicks" :key="g.y" :x="g.x" :y="H - 10" text-anchor="middle" font-size="10" fill="#5b7285">{{ g.y }}</text>
			</g>
			<line v-if="model.nomY !== null" :x1="pl" :x2="W - pr" :y1="model.nomY" :y2="model.nomY" stroke="#8aa0b2" stroke-dasharray="4 3" />
			<line v-if="model.tminY !== null" :x1="pl" :x2="W - pr" :y1="model.tminY" :y2="model.tminY" stroke="#d6336c" stroke-dasharray="6 3" stroke-width="1.5" />
			<line v-if="model.projLine" v-bind="model.projLine" stroke="#1d8fa3" stroke-dasharray="3 4" stroke-width="1.5" />
			<polyline :points="model.line" fill="none" stroke="#0b2a45" stroke-width="2" />
			<circle v-for="p in model.dots" :key="p.d" :cx="p.cx" :cy="p.cy" r="4" fill="#0b2a45"><title>{{ p.d }} : {{ p.t }} mm</title></circle>
		</svg>
		<div class="small text-muted d-flex flex-wrap gap-3">
			<span><span class="lg" style="background:#0b2a45"></span>{{ t('rbi.series') }}</span>
			<span><span class="lg" style="background:#8aa0b2"></span>{{ t('rbi.nominal') }} {{ nominal ?? '' }}</span>
			<span v-if="tmin != null"><span class="lg" style="background:#d6336c"></span>t_min {{ tmin }}</span>
			<span v-if="model.projLine"><span class="lg" style="background:#1d8fa3"></span>{{ t('rbi.projection') }}</span>
		</div>
	</div>
	<p v-else class="text-muted small mb-0">{{ t('rbi.noThickness') }}</p>
</template>

<style scoped>
.lg { display: inline-block; width: 12px; height: 3px; margin-right: 5px; vertical-align: middle; }
</style>
