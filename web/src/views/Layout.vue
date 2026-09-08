<template>
  <el-container style="height: 100vh">
    <el-aside width="200px" class="aside">
      <div class="logo">办事大厅</div>
      <el-menu router :default-active="route.path" background-color="#263445" text-color="#bfcbd9" active-text-color="#409eff">
        <el-menu-item index="/hall"><el-icon><Grid /></el-icon>事项大厅</el-menu-item>
        <el-menu-item index="/todo">
          <el-icon><Bell /></el-icon>我的待办
          <el-badge v-if="todoCount" :value="todoCount" style="margin-left: 8px" />
        </el-menu-item>
        <el-menu-item index="/mine"><el-icon><Document /></el-icon>我的申请</el-menu-item>
        <el-menu-item index="/finished"><el-icon><Finished /></el-icon>我的已办</el-menu-item>
        <el-menu-item index="/reads"><el-icon><Promotion /></el-icon>我的知会</el-menu-item>
        <el-menu-item index="/messages"><el-icon><Message /></el-icon>消息中心</el-menu-item>
        <template v-if="isAdmin">
          <div class="divider">管理端</div>
          <el-menu-item index="/admin/apps"><el-icon><Setting /></el-icon>事项管理</el-menu-item>
          <el-menu-item index="/admin/users"><el-icon><UserFilled /></el-icon>组织与权限</el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span />
        <el-dropdown @command="onCommand">
          <span class="user">{{ user?.name }}（{{ user?.department }}）</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main style="padding: 20px"><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Grid, Bell, Document, Finished, Message, Setting, Promotion, UserFilled } from '@element-plus/icons-vue';
import { api } from '../api';
import { userStore, isAdmin, logout } from '../store';

const route = useRoute();
const router = useRouter();
const user = computed(() => userStore.user);
const todoCount = ref(0);

onMounted(async () => {
  try { todoCount.value = (await api<{ todo: number }>('get', '/site/task/count')).todo; } catch { /* ignore */ }
});

function onCommand(cmd: string) {
  if (cmd === 'logout') { logout(); router.push('/login'); }
}
</script>

<style scoped>
.aside { background: #263445; }
.logo { color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 20px 0; }
.divider { color: #6b7a8d; font-size: 12px; padding: 14px 20px 6px; }
.header { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e6e8eb; }
.user { cursor: pointer; color: #303133; }
:deep(.el-menu) { border-right: none; }
</style>
