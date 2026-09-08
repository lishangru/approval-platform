<template>
  <el-card>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <h3 style="margin: 0">数据查询 · {{ app?.name }}（#{{ appId }}）</h3>
      <el-button @click="$router.push('/admin/apps')">返回事项管理</el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px">
        <el-option v-for="(n, s) in statusMap" :key="s" :label="n" :value="s" />
      </el-select>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="提交开始" end-placeholder="提交结束" style="width: 260px" />
      <el-input v-model="keyword" placeholder="搜索发起人/工号/表单内容" clearable style="width: 240px" />
      <el-button type="primary" @click="load">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <el-button type="success" plain @click="exportCsv">导出 CSV</el-button>
      <span class="count">共 {{ list.length }} 条</span>
    </div>

    <el-table :data="list" border>
      <el-table-column prop="id" label="编号" width="70" fixed />
      <el-table-column prop="creator" label="发起人" width="100" />
      <el-table-column prop="department" label="部门" width="110" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusMap[row.status] ?? row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column label="当前节点" min-width="140">
        <template #default="{ row }">{{ row.currentNodes.join('、') || '—' }}</template>
      </el-table-column>
      <el-table-column label="进度" width="110">
        <template #default="{ row }"><el-progress :percentage="row.progress" :stroke-width="8" /></template>
      </el-table-column>
      <el-table-column prop="createdAt" label="提交时间" width="160" />
      <el-table-column v-for="c in formColumns" :key="c.key" :label="c.label" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ fmt(row.data[c.key]) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push('/instance/' + row.id)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const route = useRoute();
const appId = Number(route.params.appId);
const app = ref<any>(null);
const list = ref<any[]>([]);
const formColumns = ref<{ key: string; label: string }[]>([]);
const status = ref('');
const range = ref<[string, string] | null>(null);
const keyword = ref('');

const statusMap: Record<string, string> = { draft: '草稿', running: '进行中', suspended: '挂起', finished: '已完成', revoked: '已撤销', rejected: '已否决' };
const statusType = (s: string) => ({ finished: 'success', rejected: 'danger', revoked: 'info', running: 'primary' }[s] ?? 'warning');

const q = () => ({
  ...(status.value ? { status: status.value } : {}),
  ...(range.value?.[0] ? { from: range.value[0] } : {}),
  ...(range.value?.[1] ? { to: range.value[1] } : {}),
  ...(keyword.value ? { keyword: keyword.value } : {}),
});

async function load() {
  const qs = new URLSearchParams(q() as Record<string, string>);
  list.value = await api('get', `/system/app/${appId}/instances?` + qs.toString());
}

function reset() {
  status.value = ''; range.value = null; keyword.value = '';
  load();
}

const fmt = (v: any) => (Array.isArray(v) ? v.join('、') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));

function exportCsv() {
  const qs = new URLSearchParams({ ...q() as Record<string, string>, token: localStorage.getItem('token') ?? '' });
  window.open(`/system/app/${appId}/export?` + qs.toString());
}

onMounted(async () => {
  app.value = (await api('get', '/system/app')).find((a: any) => a.id === appId);
  const forms = await api('get', `/system/form?appId=${appId}`);
  const published = forms.filter((f: any) => f.status === 'published').sort((a: any, b: any) => b.id - a.id)[0];
  formColumns.value = (published?.snapshot.components ?? []).map((c: any) => ({ key: c.key, label: c.label }));
  if (!published) ElMessage.warning('该事项还没有已发布的表单版本，无法展示表单字段列');
  load();
});
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.count { color: #909399; font-size: 12px; }
</style>
