<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Courbe d'épaisseur : UNE SÉRIE PAR CML (point de mesure), CML gouvernant en évidence, épaisseur nominale, t_min
// et projection du CML gouvernant à sa vitesse de corrosion retenue.
const props = defineProps({
	cmls: { type: Array, default: () => [] }, // [{ id, points:[{date,t}], cr, tLast, lastDate }]
	governing: String,
	nominal: Number, tmin: Number, installYear: Number,
});
const { t } = useI18n();
const W = 620, H = 250, pl = 48, pr = 16, pt = 14, pb = 32;
const ms = (d) => new Date(d + 'T00:00:00Z').getTime();
const YEAR = 365.25 * 864e5;
// Palette discrète pour distinguer les CML ; le CML gouvernant est toujours en bleu marine, plus épais.
const COLORS = ['#7a8fa3', '#5fa8a8', '#b59a5b', '#9a7ab5', '#7ab58f', '#b57a7a', '#6f86c9', '#a3a36f'];

const model = computed(() => {
	const series = props.cmls.filter((c) => c.points?.length);
	if (!series.length) return null;
	const all = series.flatMap((c) => c.points.map((p) => ({ x: ms(p.date), t: p.t })));
	const gov = series.find((c) => c.id === props.governing);
	const lastX = Math.max(...all.map((p) => p.x));
	const x0 = props.installYear ? Date.UTC(props.installYear, 6, 1) : Math.min(...all.map((p) => p.x));
	// Projection du CML gouvernant : jusqu'à t_min (ou 25 ans maximum), bornée pour rester lisible.
	let proj = null;
	if (gov && gov.cr > 0 && props.tmin != null) {
		const lastPt = gov.points[gov.points.length - 1];
		const yrs = Math.min(25, Math.max(2, (lastPt.t - props.tmin) / gov.cr));
		proj = { x0: ms(lastPt.date), t0: lastPt.t, x1: ms(lastPt.date) + yrs * YEAR, t1: lastPt.t - gov.cr * yrs };
	}
	const x1 = Math.max(lastX, proj?.x1 ?? lastX, Date.now());
	const ys = [props.nominal, props.tmin, ...all.map((p) => p.t), proj?.t1].filter((v) => Number.isFinite(v));
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
	const lines = series.map((c, i) => ({
		id: c.id, gov: c.id === props.governing, color: c.id === props.governing ? '#0b2a45' : COLORS[i % COLORS.length],
		line: c.points.map((p) => `${X(ms(p.date))},${Y(p.t)}`).join(' '),
		dots: c.points.map((p) => ({ cx: X(ms(p.date)), cy: Y(p.t), d: p.date, t: p.t })),
	})).sort((a, b) => Number(a.gov) - Number(b.gov)); // le CML gouvernant est dessiné en dernier (au-dessus)
	return {
		lines,
		projLine: proj ? { x1: X(proj.x0), y1: Y(proj.t0), x2: X(proj.x1), y2: Y(proj.t1) } : null,
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
			<g v-for="s in model.lines" :key="s.id">
				<polyline :points="s.line" fill="none" :stroke="s.color" :stroke-width="s.gov ? 2.6 : 1.4" :opacity="s.gov ? 1 : 0.85" />
				<circle v-for="p in s.dots" :key="p.d" :cx="p.cx" :cy="p.cy" :r="s.gov ? 4.2 : 2.8" :fill="s.color"><title>{{ s.id }} · {{ p.d }} : {{ p.t }} mm</title></circle>
			</g>
		</svg>
		<div class="small text-muted d-flex flex-wrap gap-3">
			<span v-for="s in [...model.lines].reverse()" :key="s.id"><span class="lg" :style="{ background: s.color, height: s.gov ? '4px' : '3px' }"></span><span :class="{ 'fw-semibold text-body': s.gov }">{{ s.id }}<template v-if="s.gov"> ({{ t('rbi.governing') }})</template></span></span>
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
