<script setup lang="ts">
defineProps<{ error?: Error }>()
function reload() {
  window.location.reload()
}
</script>

<template>
  <div class="chart-card" :role="error ? 'alert' : 'status'" aria-live="polite">
    <p>{{ error ? '图表组件加载失败，请刷新页面重试。' : '正在加载图表组件…' }}</p>
    <button v-if="error" type="button" class="text-button" @click="reload">刷新重试</button>
  </div>
</template>
