<template>
  <div class="login-bg">
    <el-card class="login-card">
      <h2 style="text-align: center; margin: 0 0 4px">网上办事大厅</h2>
      <p style="text-align: center; color: #909399; margin-top: 0">统一身份认证 · 审批平台</p>
      <el-form @submit.prevent="onLogin">
        <el-form-item>
          <el-input v-model="username" placeholder="学号 / 工号" size="large">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-input v-model="password" type="password" placeholder="密码" size="large" show-password>
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" native-type="submit">
          登 录
        </el-button>
      </el-form>
      <el-alert style="margin-top: 14px" type="info" :closable="false"
        title="演示账号" description="学生 lishangru/123456 · 部门领导 wangjianguo/123456 · 学工处 zhangmin/123456 · 校办 xiaozhang/123456 · 管理员 admin/admin123" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { setUser } from '../store';

const router = useRouter();
const username = ref('');
const password = ref('');
const loading = ref(false);

async function onLogin() {
  if (!username.value || !password.value) return ElMessage.warning('请输入账号密码');
  loading.value = true;
  try {
    const d = await api<{ token: string; principal: any }>('post', '/api/auth/login', { username: username.value, password: password.value });
    setUser(d.principal, d.token);
    ElMessage.success('欢迎，' + d.principal.name);
    router.push('/hall');
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-bg { height: 100vh; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1c5fa8 0%, #2b85d8 60%, #7db8e8 100%); }
.login-card { width: 380px; padding: 10px 8px; }
</style>
