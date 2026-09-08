<template>
  <div style="width: 100%">
    <el-select :model-value="kind" @update:model-value="$emit('update:kind', $event)" style="width: 200px">
      <el-option label="全部人员" value="all" />
      <el-option label="固定角色" value="role" />
      <el-option label="用户组" value="group" />
      <el-option label="指定部门" value="department" />
      <el-option label="指定人员" value="fixed" />
    </el-select>
    <el-input v-if="kind === 'role'" class="sv-value" :model-value="roleValue" @update:model-value="$emit('update:value', $event)" placeholder="角色 key，如 office" />
    <el-select v-else-if="kind === 'group'" class="sv-value" :model-value="groupValue" @update:model-value="$emit('update:value', $event)" placeholder="选择用户组">
      <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
    </el-select>
    <el-select v-else-if="kind === 'department'" class="sv-value" :model-value="deptValue" @update:model-value="$emit('update:value', $event)" placeholder="选择部门">
      <el-option v-for="d in departments" :key="d.deptId" :label="d.name" :value="d.deptId" />
    </el-select>
    <el-select v-else-if="kind === 'fixed'" class="sv-value" :model-value="fixedUids" multiple filterable @update:model-value="$emit('update:value', $event)" placeholder="选择人员">
      <el-option v-for="u in users" :key="u.id" :label="`${u.name}（${u.department}）`" :value="u.id" />
    </el-select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  kind: string;
  value: any;
  users: { id: number; name: string; department: string }[];
  groups: string[];
  departments: { deptId: number; name: string }[];
}>();
const emit = defineEmits<{ (e: 'update:kind', v: string): void; (e: 'update:value', v: any): void }>();

const roleValue = computed({
  get: () => (props.kind === 'role' ? String(props.value ?? '') : ''),
  set: (v: string) => emit('update:value', v),
});
const groupValue = computed({
  get: () => (props.kind === 'group' ? String(props.value ?? '') : ''),
  set: (v: string) => emit('update:value', v),
});
const deptValue = computed({
  get: () => (props.kind === 'department' ? Number(props.value ?? 0) : undefined),
  set: (v: number) => emit('update:value', v),
});
const fixedUids = computed({
  get: () => (props.kind === 'fixed' ? (props.value as number[] ?? []) : []),
  set: (v: number[]) => emit('update:value', v),
});
</script>

<style scoped>
.sv-value { width: 240px; margin-left: 8px; }
</style>
