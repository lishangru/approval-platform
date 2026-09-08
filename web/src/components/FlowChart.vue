<template>
  <div class="flow-chart">
    <FlowTreeNode v-if="root" :node="root" :edges="edges" :path="[root.id]" />
  </div>
</template>

<script setup lang="ts">
import { computed, provide } from 'vue';
import FlowTreeNode from './FlowTreeNode.vue';

const props = defineProps<{
  nodes: { id: string; name: string; kind: string; state: string; handlers?: string[]; candidates?: string[] }[];
  edges?: { from: string; to: string; label?: string; taken?: boolean }[];
}>();

provide('flowNodes', props.nodes);

// 无边数据时退化为线性串联（兼容旧结构；默认视为已走过）
const edges = computed(() => {
  if (props.edges?.length) return props.edges;
  const out: { from: string; to: string; taken?: boolean }[] = [];
  for (let i = 0; i < props.nodes.length - 1; i++) out.push({ from: props.nodes[i].id, to: props.nodes[i + 1].id, taken: true });
  return out;
});

const root = computed(() => props.nodes.find((n) => n.kind === 'start') ?? props.nodes[0]);
</script>

<style scoped>
.flow-chart { display: flex; flex-direction: column; align-items: center; padding: 16px 0; }
</style>
