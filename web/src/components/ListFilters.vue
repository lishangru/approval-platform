<template>
  <div class="list-toolbar">
    <el-input v-model="keyword" :placeholder="keywordPlaceholder" clearable style="width: 220px" />
    <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD"
      start-placeholder="开始日期" end-placeholder="结束日期" style="width: 260px" />
    <slot />
    <el-button @click="$emit('export')">导出 CSV</el-button>
    <span class="count">共 {{ count }} 条</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const keyword = defineModel<string>('keyword', { default: '' });
const range = defineModel<[string, string] | null>('range', { default: null });
defineProps<{ keywordPlaceholder?: string; count: number }>();
defineEmits<{ (e: 'export'): void }>();

// 给父组件用：判断行是否命中筛选
const match = (row: { createdAt?: string }, text: string) => {
  if (keyword.value && !text.toLowerCase().includes(keyword.value.toLowerCase())) return false;
  if (range.value?.[0] && row.createdAt && row.createdAt < range.value[0] + ' 00:00:00') return false;
  if (range.value?.[1] && row.createdAt && row.createdAt > range.value[1] + ' 23:59:59') return false;
  return true;
};
const params = () => ({ from: range.value?.[0] ?? '', to: range.value?.[1] ?? '', keyword: keyword.value });
defineExpose({ match, params });
</script>

<style scoped>
.list-toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.count { color: #909399; font-size: 12px; }
</style>
