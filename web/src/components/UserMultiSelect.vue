<template>
  <el-popover :width="340" trigger="click" popper-class="ums-popover">
    <template #reference>
      <el-button :type="modelValue.length ? 'primary' : 'default'" plain>
        {{ modelValue.length ? `已选 ${modelValue.length} 人` : (placeholder ?? '选择人员') }}
      </el-button>
    </template>
    <div style="display: flex; gap: 6px; margin-bottom: 8px">
      <el-input v-model="search" size="small" placeholder="搜索姓名/部门/用户组" clearable />
      <el-button size="small" @click="modelValue.length = 0">清空</el-button>
    </div>
    <el-checkbox-group :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" style="max-height: 260px; overflow: auto">
      <div v-for="u in filtered" :key="u.id" style="padding: 2px 0">
        <el-checkbox :value="u.id">{{ u.name }}<span class="sub">（{{ u.department }}{{ u.group ? ' · ' + u.group : '' }}）</span></el-checkbox>
      </div>
      <el-empty v-if="!filtered.length" description="无匹配人员" :image-size="40" />
    </el-checkbox-group>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  modelValue: number[];
  users: { id: number; name: string; department: string; group?: string }[];
  placeholder?: string;
}>();
defineEmits<{ (e: 'update:modelValue', v: number[]): void }>();

const search = ref('');
const filtered = computed(() => {
  const k = search.value.trim().toLowerCase();
  if (!k) return props.users;
  return props.users.filter((u) => `${u.name}${u.department}${u.group ?? ''}`.toLowerCase().includes(k));
});
</script>

<style>
.ums-popover .sub { color: #909399; font-size: 12px; }
</style>
