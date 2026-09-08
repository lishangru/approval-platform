<template>
  <h2>我的知会</h2>
  <ListFilters ref="filters" keyword-placeholder="搜索内容" :count="filtered.length" @export="exportCsv">
    <el-select v-model="appId" placeholder="全部事项" clearable style="width: 180px">
      <el-option v-for="a in apps" :key="a.id" :label="a.name" :value="a.id" />
    </el-select>
  </ListFilters>
  <el-table :data="filtered" border>
    <el-table-column prop="createdAt" label="时间" width="170" />
    <el-table-column prop="appName" label="事项" min-width="130" />
    <el-table-column label="编号" width="80">
      <template #default="{ row }">{{ row.instanceId ? '#' + row.instanceId : '—' }}</template>
    </el-table-column>
    <el-table-column prop="body" label="内容" min-width="300" show-overflow-tooltip />
    <el-table-column label="状态" width="80">
      <template #default="{ row }"><el-tag size="small" :type="row.read ? 'info' : 'warning'">{{ row.read ? '已读' : '未读' }}</el-tag></template>
    </el-table-column>
    <el-table-column label="操作" width="100" fixed="right">
      <template #default="{ row }">
        <el-button v-if="row.instanceId" size="small" text type="primary" @click="$router.push('/instance/' + row.instanceId)">查看</el-button>
      </template>
    </el-table-column>
  </el-table>
  <el-empty v-if="!filtered.length" description="暂无知会记录" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import ListFilters from '../components/ListFilters.vue';

const filters = ref<any>();
const list = ref<any[]>([]);
const apps = ref<any[]>([]);
const appId = ref<number | null>(null);

const refresh = async () => {
  list.value = await api('get', '/site/my-read');
};
onMounted(async () => {
  await refresh();
  apps.value = await api('get', '/site/apps');
});

const filtered = computed(() => {
  const p = filters.value?.params() ?? { from: '', to: '', keyword: '' };
  return list.value
    .filter((m) => (!p.from || m.createdAt >= p.from + ' 00:00:00') && (!p.to || m.createdAt <= p.to + ' 23:59:59'))
    .filter((m) => !appId.value || m.appId === appId.value)
    .filter((m) => !p.keyword || (m.title + m.body).toLowerCase().includes(p.keyword.toLowerCase()));
});

function exportCsv() {
  const p = filters.value?.params() ?? {};
  const token = localStorage.getItem('token');
  const qs = new URLSearchParams({ ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}), ...(p.keyword ? { keyword: p.keyword } : {}), ...(appId.value ? { appId: String(appId.value) } : {}), token });
  window.open('/site/my-read/export?' + qs.toString());
}
</script>
