<template>
  <h2>事项大厅</h2>
  <el-row :gutter="16">
    <el-col v-for="a in apps" :key="a.id" :span="6" style="margin-bottom: 16px">
      <el-card shadow="hover">
        <div style="display: flex; align-items: center; gap: 12px">
          <div class="icon">{{ a.name.slice(0, 1) }}</div>
          <div style="flex: 1">
            <div style="font-weight: 600">{{ a.name }}</div>
            <div style="color: #909399; font-size: 12px">{{ a.desc }}</div>
          </div>
        </div>
        <div style="margin-top: 14px; text-align: right">
          <el-button type="primary" size="small" :disabled="!a.published" @click="$router.push('/launch/' + a.id)">立即办理</el-button>
        </div>
      </el-card>
    </el-col>
  </el-row>
  <el-empty v-if="!apps.length" description="暂无已发布事项" />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

const apps = ref<{ id: number; name: string; desc: string; icon: string; published: boolean }[]>([]);
onMounted(async () => { apps.value = await api('get', '/site/apps'); });
</script>

<style scoped>
.icon { width: 44px; height: 44px; border-radius: 10px; background: #409eff; color: #fff; font-size: 20px; display: flex; align-items: center; justify-content: center; }
</style>
