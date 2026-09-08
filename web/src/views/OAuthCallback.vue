<template>
  <div style="height: 100vh; display: flex; align-items: center; justify-content: center">
    <el-result v-if="error" icon="error" :title="'第三方登录失败'" :sub-title="error">
      <template #extra><el-button type="primary" @click="$router.push('/login')">返回登录</el-button></template>
    </el-result>
    <el-result v-else icon="success" title="登录成功" sub-title="正在进入办事大厅...">
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { setUser } from '../store';

const route = useRoute();
const router = useRouter();
const error = ref('');

onMounted(async () => {
  const token = String(route.query.token ?? '');
  if (!token) { error.value = '缺少 token'; return; }
  try {
    const principal = await api('get', '/site/me?token=' + encodeURIComponent(token));
    setUser(principal, token);
    router.replace('/hall');
  } catch (e: any) {
    error.value = e.message;
  }
});
</script>
