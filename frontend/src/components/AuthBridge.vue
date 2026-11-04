<script setup lang="ts">
import { useAuth } from '@clerk/vue'
import { setTokenProvider } from '../auth'
const { getToken } = useAuth()
setTokenProvider(() => getToken.value())
</script>
<template><span hidden aria-hidden="true"></span></template>
