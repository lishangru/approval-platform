<template>
  <h2>我的申请</h2>
  <ListFilters ref="filters" keyword-placeholder="搜索事项/当前节点" :count="filtered.length" @export="exportCsv" />
  <el-table :data="filtered" border>
    <el-table-column prop="id" label="编号" width="80" />
    <el-table-column prop="appName" label="事项" min-width="140" />
    <el-table-column label="状态" width="110">
      <template #default="{ row }">
        <el-tag :type="statusType(row.status)">{{ statusName(row.status) }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="当前节点" min-width="160">
      <template #default="{ row }">{{ row.currentNodeNames.join('、') || '—' }}</template>
    </el-table-column>
    <el-table-column label="进度" width="150">
      <template #default="{ row }"><el-progress :percentage="row.progress" :stroke-width="10" /></template>
    </el-table-column>
    <el-table-column prop="createdAt" label="提交时间" width="160" />
    <el-table-column label="操作" width="200" fixed="right">
      <template #default="{ row }">
        <el-button size="small" @click="$router.push('/instance/' + row.id)">详情</el-button>
        <el-button v-if="row.status === 'running'" size="small" type="danger" plain @click="onRevoke(row)">撤销</el-button>
        <el-button v-if="row.currentNodeNames.includes('发起')" size="small" type="warning" plain @click="$router.push('/instance/' + row.id)">修改重报</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import ListFilters from '../components/ListFilters.vue';
import { downloadCsv } from '../csv';

const filters = ref<any>();
const list = ref<any[]>([]);
const refresh = async () => { list.value = await api('get', '/site/instance/mine'); };
onMounted(refresh);

const filtered = computed(() => {
  const p = filters.value?.params() ?? { from: '', to: '', keyword: '' };
  return list.value
    .filter((r) => (!p.from || r.createdAt >= p.from + ' 00:00:00') && (!p.to || r.createdAt <= p.to + ' 23:59:59'))
    .filter((r) => !p.keyword || (r.appName + r.currentNodeNames.join()).toLowerCase().includes(p.keyword.toLowerCase()));
});

function exportCsv() {
  downloadCsv('我的申请.csv', ['编号', '事项', '状态', '当前节点', '进度%', '提交时间', '完成时间'],
    filtered.value.map((r) => [r.id, r.appName, statusName(r.status), r.currentNodeNames.join('、'), r.progress, r.createdAt, r.finishedAt ?? '']));
}

const statusName = (s: string) => ({ draft: '草稿', running: '进行中', suspended: '挂起', finished: '已完成', revoked: '已撤销', rejected: '已否决' }[s] ?? s);
const statusType = (s: string) => ({ finished: 'success', rejected: 'danger', revoked: 'info', running: 'primary' }[s] ?? 'warning');

async function onRevoke(row: any) {
  await ElMessageBox.confirm('确定撤销该申请？撤销后不可恢复', '提示', { type: 'warning' });
  await api('post', `/site/instance/${row.id}/revoke`);
  ElMessage.success('已撤销');
  refresh();
}
</script>
