<script setup lang="ts">
import { Mail } from '@lucide/vue'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../contact'

defineProps<{ label?: string }>()
</script>

<template>
  <a class="footer-contact" :href="SUPPORT_MAILTO" :aria-label="label">
    <Mail :size="15" :stroke-width="1.9" aria-hidden="true" />
    <span>{{ SUPPORT_EMAIL }}</span>
  </a>
</template>
