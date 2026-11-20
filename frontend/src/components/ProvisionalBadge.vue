<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toastification';
import { api } from '@/api';
import { auth } from '@/stores/auth';
import { settings } from '@/stores/settings';

// Pastille « Provisoire » (valeur de test à arbitrer) ou « Validé le … ». L'administrateur peut valider (ou retirer la validation).
// k = clé du paramètre (ex. « matrix », « template:EXD »). Toute modification du paramètre le repasse en « provisoire ».
const props = defineProps({ k: { type: String, required: true }, editable: { type: Boolean, default: false } });
const emit = defineEmits(['changed']);
const { t } = useI18n();
const toast = useToast();

const validatedAt = computed(() => settings.data?._meta?.validated?.[props.k] ?? null);
const canValidate = computed(() => props.editable && auth.user?.isAdmin);

async function toggle() {
	try {
		await api(`/settings/${encodeURIComponent(props.k)}/validate`, { method: 'POST', body: { validated: !validatedAt.value } });
		await settings.load(true);
		emit('changed');
	} catch (e) { toast.error(e.message); }
}
</script>

<template>
	<span class="prov d-inline-flex align-items-center gap-1">
		<span v-if="!validatedAt" class="badge text-bg-warning" :title="t('prov.hint')"><i class="fa-solid fa-flask me-1"></i>{{ t('prov.badge') }}</span>
		<span v-else class="badge text-bg-success" :title="validatedAt"><i class="fa-solid fa-check me-1"></i>{{ t('prov.validatedOn', { date: validatedAt.slice(0, 10) }) }}</span>
		<button v-if="canValidate" type="button" class="btn btn-link btn-sm p-0 small" @click="toggle">{{ validatedAt ? t('prov.unvalidate') : t('prov.validate') }}</button>
	</span>
</template>
