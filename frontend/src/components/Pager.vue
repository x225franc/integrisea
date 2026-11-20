<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({ page: Number, total: Number, limit: { type: Number, default: 50 } });
const emit = defineEmits(['update:page']);
const { t } = useI18n();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)));
</script>

<template>
	<div v-if="pages > 1" class="d-flex justify-content-center align-items-center gap-2 p-2 border-top">
		<button class="btn btn-sm btn-light" :disabled="page <= 1" @click="emit('update:page', page - 1)"><i class="fa-solid fa-chevron-left"></i></button>
		<span class="small">{{ t('common.page') }} {{ page }} {{ t('common.of') }} {{ pages }}</span>
		<button class="btn btn-sm btn-light" :disabled="page >= pages" @click="emit('update:page', page + 1)"><i class="fa-solid fa-chevron-right"></i></button>
	</div>
</template>
