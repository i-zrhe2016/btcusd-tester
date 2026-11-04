<script setup lang="ts">
withDefaults(defineProps<{ error?: Error; message?: string }>(), {
  message: '正在加载图表组件…',
})
function reload() {
  window.location.reload()
}
</script>

<template>
  <div class="chart-card chart-load-state flex flex-col items-center justify-center gap-3 w-full h-full min-h-0 m-0 p-6 rounded-none border-0 bg-[#f1f0ea] text-[#454940] text-center shadow-none" :role="error ? 'alert' : 'status'" aria-live="polite">
    <span v-if="!error" class="chart-load-spinner block w-7 h-7 rounded-full border-[3px] border-solid border-[#d9ddd1] border-t-[#667554]" aria-hidden="true"></span>
    <p class="m-0 font-bold">{{ error ? '图表组件加载失败，请刷新页面重试。' : message }}</p>
    <span v-if="!error" class="chart-load-note text-xs text-[#6b7066]">准备就绪后将自动显示 K 线</span>
    <button v-if="error" type="button" class="text-button font-bold" @click="reload">刷新重试</button>
  </div>
</template>
