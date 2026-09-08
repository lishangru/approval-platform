<template>
  <h2>我的已办</h2>
  <ListFilters ref="filters" keyword-placeholder="搜索事项/节点/意见" :count="filtered.length" @export="exportCsv" />
  <el-table :data="filtered" border>
    <el-table-column prop="instanceId" label="编号" width="80" />
    <el-table-column prop="appName" label="事项" min-width="140" />
    <el-table-column prop="nodeName" label="处理节点" min-width="140" />
    <el-table-column label="操作" width="110">
      <template #default="{ row }"><el-tag size="small">{{ row.action }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="comment" label="意见" min-width="200" show-overflow-tooltip />
    <el-table-column prop="dealtAt" label="处理时间" width="160" />
    <el-table-column label="操作" width="100" fixed="right">
      <template #default="{ row }">
        <el-button size="small" @click="$router.push('/instance/' + row.instanceId)">查看</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import ListFilters from '../components/ListFilters.vue';
import { downloadCsv } from '../csv';

const filters = ref<any>();
const list = ref<any[]>([]);
onMounted(async () => { list.value = await api('get', '/site/task/list?box=finished'); });

const filtered = computed(() => {
  const p = filters.value?.params() ?? { from: '', to: '', keyword: '' };
  return list.value
    .filter((r) => (!p.from || r.dealtAt >= p.from + ' 00:00:00') && (!p.to || r.dealtAt <= p.to + ' 23:59:59'))
    .filter((r) => !p.keyword || (r.appName + r.nodeName + r.action + r.comment).toLowerCase().includes(p.keyword.toLowerCase()));
});

function exportCsv() {
  downloadCsv('我的已办.csv', ['编号', '事项', '节点', '操作', '意见', '处理时间'],
    filtered.value.map((r) => [r.instanceId, r.appName, r.nodeName, r.action, r.comment, r.dealtAt]));
}
</script>
