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
              <el-dropdown-item command="signature">我的签名</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main style="padding: 20px"><router-view /></el-main>
    </el-container>

    <!-- 我的签名：上传图片 / 手写板 -->
    <el-dialog v-model="sigDialog" title="我的签名" width="460px">
      <div style="display: flex; gap: 16px">
        <div style="flex: 1">
          <div style="color: #909399; font-size: 12px; margin-bottom: 6px">当前签名（将显示在审批单 PDF 的处理人格内，经个人数字证书认证）</div>
          <div class="sig-preview">
            <img v-if="sigInfo.has" :src="sigImgUrl" alt="签名" />
            <span v-else style="color: #c0c4cc">尚未设置</span>
          </div>
          <div v-if="sigInfo.has" style="color: #909399; font-size: 11px; margin-top: 4px; word-break: break-all">
            SHA-256：{{ sigInfo.hash.slice(0, 24) }}…<br />设置于 {{ sigInfo.updatedAt }}
          </div>
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
          <el-button size="small" @click="pickFile">上传签名图片</el-button>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg" style="display: none" @change="onFilePicked" />
          <canvas ref="pad" width="200" height="100" class="sig-pad"
            @mousedown="padDown" @mousemove="padMove" @mouseup="padUp" @mouseleave="padUp" />
          <el-button size="small" @click="clearPad">清空手写</el-button>
          <el-button size="small" type="primary" :disabled="!padDirty" @click="savePad">使用手写签名</el-button>
          <el-button v-if="sigInfo.has" size="small" type="danger" plain @click="removeSig">清除签名</el-button>
        </div>
      </div>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Grid, Bell, Document, Finished, Message, Setting, Promotion, UserFilled } from '@element-plus/icons-vue';
import { api, apiRaw } from '../api';
import { userStore, isAdmin, logout } from '../store';

const route = useRoute();
const router = useRouter();
const user = computed(() => userStore.user);
const todoCount = ref(0);

// ---- 我的签名 ----
const sigDialog = ref(false);
const sigInfo = ref<any>({ has: false });
const fileInput = ref<HTMLInputElement | null>(null);
const pad = ref<HTMLCanvasElement | null>(null);
const padDirty = ref(false);
let drawing = false;
const sigImgUrl = computed(() => '/api/mysignature/image?token=' + encodeURIComponent(localStorage.getItem('token') ?? '') + '&t=' + (sigInfo.value.updatedAt ?? ''));

async function openSignature() {
  sigDialog.value = true;
  sigInfo.value = await api('get', '/api/mysignature').catch(() => ({ has: false }));
}

async function uploadSig(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const resp = await apiRaw<any>('post', '/api/mysignature', fd);
  if (resp.e !== 0) return ElMessage.error(resp.m);
  ElMessage.success('签名已保存（已用个人数字证书认证绑定）');
  sigInfo.value = await api('get', '/api/mysignature');
}

function pickFile() { fileInput.value?.click(); }

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) uploadSig(input.files[0]);
  input.value = '';
}

function padPos(e: MouseEvent) {
  const c = pad.value!;
  const rect = c.getBoundingClientRect();
  return [(e.clientX - rect.left) * (c.width / rect.width), (e.clientY - rect.top) * (c.height / rect.height)] as const;
}
function padDown(e: MouseEvent) { drawing = true; padDirty.value = true; const ctx = pad.value!.getContext('2d')!; const [x, y] = padPos(e); ctx.beginPath(); ctx.moveTo(x, y); }
function padMove(e: MouseEvent) {
  if (!drawing) return;
  const ctx = pad.value!.getContext('2d')!;
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a1a';
  const [x, y] = padPos(e);
  ctx.lineTo(x, y); ctx.stroke();
}
function padUp() { drawing = false; }
function clearPad() {
  const c = pad.value!;
  c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  padDirty.value = false;
}

async function savePad() {
  const blob = await new Promise<Blob | null>((r) => pad.value!.toBlob(r, 'image/png'));
  if (blob) await uploadSig(new File([blob], 'signature.png', { type: 'image/png' }));
  clearPad();
}

async function removeSig() {
  await api('delete', '/api/mysignature');
  ElMessage.success('已清除');
  sigInfo.value = { has: false };
}

onMounted(async () => {
  try { todoCount.value = (await api<{ todo: number }>('get', '/site/task/count')).todo; } catch { /* ignore */ }
});

function onCommand(cmd: string) {
  if (cmd === 'logout') { logout(); router.push('/login'); }
  if (cmd === 'signature') openSignature();
}
</script>

<style scoped>
.aside { background: #263445; }
.logo { color: #fff; font-size: 18px; font-weight: 700; text-align: center; padding: 20px 0; }
.divider { color: #6b7a8d; font-size: 12px; padding: 14px 20px 6px; }
.header { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e6e8eb; }
.user { cursor: pointer; color: #303133; }
.sig-preview { width: 200px; height: 100px; border: 1px dashed #dcdfe6; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: #fafafa; }
.sig-preview img { max-width: 190px; max-height: 92px; object-fit: contain; }
.sig-pad { width: 200px; height: 100px; border: 1px dashed #dcdfe6; border-radius: 6px; background: #fff; cursor: crosshair; touch-action: none; }
:deep(.el-menu) { border-right: none; }
</style>
