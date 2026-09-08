<template>
  <h2>我的待办</h2>
  <ListFilters ref="filters" keyword-placeholder="搜索事项/节点/发起人" :count="filtered.length" @export="exportCsv" />
  <el-table :data="filtered" border>
    <el-table-column prop="taskId" label="任务" width="80" />
    <el-table-column prop="appName" label="事项" min-width="140" />
    <el-table-column prop="nodeName" label="当前节点" min-width="140" />
    <el-table-column prop="creator" label="发起人" width="110" />
    <el-table-column prop="createdAt" label="到达时间" width="160" />
    <el-table-column label="操作" width="120" fixed="right">
      <template #default="{ row }">
        <el-button type="primary" size="small" @click="$router.push('/deal/' + row.taskId)">去处理</el-button>
      </template>
    </el-table-column>
  </el-table>
  <el-empty v-if="!filtered.length" description="没有待办任务，休息一下吧" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import ListFilters from '../components/ListFilters.vue';
import { downloadCsv } from '../csv';

const filters = ref<any>();
const list = ref<any[]>([]);
onMounted(async () => { list.value = await api('get', '/site/task/list?box=todo'); });

const filtered = computed(() => {
  const p = filters.value?.params() ?? { from: '', to: '', keyword: '' };
  return list.value
    .filter((r) => (!p.from || r.createdAt >= p.from + ' 00:00:00') && (!p.to || r.createdAt <= p.to + ' 23:59:59'))
    .filter((r) => !p.keyword || (r.appName + r.nodeName + r.creator).toLowerCase().includes(p.keyword.toLowerCase()));
});

function exportCsv() {
  downloadCsv('我的待办.csv', ['任务ID', '事项', '节点', '发起人', '到达时间'],
    filtered.value.map((r) => [r.taskId, r.appName, r.nodeName, r.creator, r.createdAt]));
}
</script>
