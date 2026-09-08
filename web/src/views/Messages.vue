<template>
  <h2>消息中心</h2>
  <el-button size="small" style="margin-bottom: 10px" @click="readAll">全部标为已读</el-button>
  <el-table :data="list" border :row-class-name="rowClass">
    <el-table-column prop="title" label="标题" width="180" />
    <el-table-column prop="body" label="内容" min-width="280" />
    <el-table-column prop="createdAt" label="时间" width="170" />
    <el-table-column label="操作" width="100">
      <template #default="{ row }">
        <el-button v-if="row.instanceId" size="small" text type="primary" @click="$router.push('/instance/' + row.instanceId)">查看</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

const list = ref<any[]>([]);
const refresh = async () => { list.value = await api('get', '/site/message/list'); };
onMounted(refresh);
const rowClass = ({ row }: any) => (row.read ? '' : 'unread-row');
async function readAll() {
  await api('post', '/site/message/read', {});
  refresh();
}
</script>

<style>
.unread-row { font-weight: 600; }
</style>
