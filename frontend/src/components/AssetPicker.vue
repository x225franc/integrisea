<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api';
import { auth } from '@/stores/auth';

// Recherche d'un actif par tag ou description. v-model = actif sélectionné { id, tag, description, classCode, facilityId }.
const props = defineProps({ modelValue: Object, minRole: { type: String, default: 'inspector' }, disabled: Boolean });
const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();
const q = ref('');
const results = ref([]);
const open = ref(false);
let timer;

watch(q, (v) => {
	clearTimeout(timer);
	if (v.trim().length < 2) { results.value = []; return; }
	timer = setTimeout(async () => {
		const r = await api('/assets', { query: { q: v, limit: 20 } });
		results.value = r.items.filter((a) => auth.can(a.facilityId, props.minRole));
		open.value = true;
	}, 250);
});
const pick = (a) => { emit('update:modelValue', a); open.value = false; q.value = ''; results.value = []; };
</script>

<template>
	<div class="position-relative">
		<div v-if="modelValue" class="d-flex align-items-center gap-2 form-control">
			<strong>{{ modelValue.tag }}</strong><span class="text-muted small text-truncate">{{ modelValue.description }}</span>
			<button v-if="!disabled" type="button" class="btn-close ms-auto" @click="emit('update:modelValue', null)"></button>
		</div>
		<template v-else>
			<input v-model="q" class="form-control" :placeholder="t('insp.chooseAsset')" autocomplete="off" @focus="open = true" />
			<div v-if="open && results.length" class="list-group position-absolute w-100 shadow" style="z-index: 20; max-height: 240px; overflow: auto">
				<button v-for="a in results" :key="a.id" type="button" class="list-group-item list-group-item-action py-1" @click="pick(a)">
					<strong>{{ a.tag }}</strong> <span class="text-muted small">{{ a.description }}</span>
				</button>
			</div>
		</template>
	</div>
</template>
