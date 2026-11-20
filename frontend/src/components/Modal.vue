<script setup>
import { onMounted, onUnmounted } from 'vue';
defineProps({ title: String, wide: Boolean });
const emit = defineEmits(['close']);
const onKey = (e) => e.key === 'Escape' && emit('close');
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
	<div class="modal-scrim" @mousedown.self="emit('close')">
		<div class="modal-box" :class="{ wide }" role="dialog" aria-modal="true">
			<header>
				<span>{{ title }}</span>
				<button type="button" class="btn-close" aria-label="Close" @click="emit('close')"></button>
			</header>
			<div class="body"><slot /></div>
			<footer v-if="$slots.footer"><slot name="footer" /></footer>
		</div>
	</div>
</template>
