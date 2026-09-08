<template>
  <el-card>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <h3 style="margin: 0">组织与权限</h3>
      <el-button @click="$router.push('/admin/apps')">返回事项管理</el-button>
    </div>

    <el-tabs v-model="tab">
      <!-- ============ 用户 ============ -->
      <el-tab-pane label="用户" name="users">
        <div style="margin-bottom: 10px; display: flex; gap: 10px">
          <el-input v-model="uKeyword" placeholder="搜索姓名/账号/部门" clearable style="width: 240px" />
          <el-button type="primary" @click="openUserDialog()">+ 新建用户</el-button>
        </div>
        <el-table :data="filteredUsers" border>
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="username" label="账号" width="110" />
          <el-table-column prop="name" label="姓名" width="100" />
          <el-table-column prop="number" label="学工号" width="110" />
          <el-table-column prop="department" label="部门" width="110" />
          <el-table-column label="角色" min-width="150">
            <template #default="{ row }">
              <el-tag v-for="r in row.roles" :key="r" size="small" style="margin-right: 4px">{{ roleName(r) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="group" label="用户组" width="130" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.status === 'disabled' ? 'danger' : 'success'" size="small">{{ row.status === 'disabled' ? '已禁用' : '启用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="openUserDialog(row)">编辑</el-button>
              <el-button size="small" @click="resetPwd(row)">重置密码</el-button>
              <el-button size="small" :type="row.status === 'disabled' ? 'success' : 'warning'" plain @click="toggleUser(row)">
                {{ row.status === 'disabled' ? '启用' : '禁用' }}
              </el-button>
              <el-button size="small" type="danger" plain @click="deleteUser(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ============ 角色（权限组） ============ -->
      <el-tab-pane label="角色（权限组）" name="roles">
        <div style="margin-bottom: 10px">
          <el-button type="primary" @click="roleDialog = true">+ 新建角色</el-button>
        </div>
        <el-table :data="roles" border>
          <el-table-column prop="key" label="Key" width="140" />
          <el-table-column prop="name" label="名称" width="140" />
          <el-table-column prop="desc" label="说明" min-width="240" />
          <el-table-column prop="usersCount" label="用户数" width="90" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }"><el-tag size="small" :type="row.builtin ? 'info' : 'primary'">{{ row.builtin ? '内置' : '自定义' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button size="small" type="danger" plain :disabled="row.builtin" @click="deleteRole(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ============ 部门 ============ -->
      <el-tab-pane label="部门" name="departments">
        <div style="margin-bottom: 10px; display: flex; gap: 10px">
          <el-input v-model="newDeptName" placeholder="新部门名称" style="width: 220px" />
          <el-button type="primary" @click="createDept">+ 新建部门</el-button>
        </div>
        <el-table :data="departments" border>
          <el-table-column prop="deptId" label="部门 ID" width="100" />
          <el-table-column label="名称" min-width="160">
            <template #default="{ row }">
              <el-input v-if="editingDept === row.id" v-model="deptEditName" size="small" style="width: 160px" />
              <span v-else>{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="usersCount" label="用户数" width="90" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <template v-if="editingDept === row.id">
                <el-button size="small" type="primary" @click="saveDept(row)">保存</el-button>
                <el-button size="small" @click="editingDept = null">取消</el-button>
              </template>
              <el-button v-else size="small" @click="editingDept = row.id; deptEditName = row.name">重命名</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ============ API 密钥 ============ -->
      <el-tab-pane label="API 密钥" name="apikeys">
        <el-alert type="info" :closable="false" style="margin-bottom: 10px"
          title="供第三方平台调用开放接口（如查询审批状态）。请求头携带 X-API-Key，完整密钥仅在创建时展示一次。" />
        <div style="margin-bottom: 10px; display: flex; gap: 10px">
          <el-input v-model="newKeyName" placeholder="密钥用途，如：一卡通系统" style="width: 260px" />
          <el-button type="primary" @click="createKey">生成密钥</el-button>
        </div>
        <el-table :data="apikeys" border>
          <el-table-column prop="name" label="用途" min-width="160" />
          <el-table-column prop="keyMasked" label="密钥" min-width="200" />
          <el-table-column prop="createdAt" label="创建时间" width="170" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">{{ row.status === 'active' ? '启用' : '已吊销' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button size="small" :type="row.status === 'active' ? 'warning' : 'success'" plain @click="toggleKey(row)">
                {{ row.status === 'active' ? '吊销' : '恢复' }}
              </el-button>
              <el-button size="small" type="danger" plain @click="deleteKey(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div style="margin-top: 12px; color: #909399; font-size: 12px">
          开放接口：<code>GET /open/approval/status?username=学工号&amp;app=事项名称</code>
          （Header <code>X-API-Key: ak_xxx</code>，返回 approved 是否通过 / status 状态）
        </div>
      </el-tab-pane>
      <!-- ============ 个人签章 ============ -->
      <el-tab-pane label="个人签章" name="seals">
        <el-alert type="info" :closable="false" style="margin-bottom: 10px"
          title="每个审批人首次签批时自动生成个人数字证书（PKCS#7 签名），审批日志与 PDF 申请单逐级附签。重置后，用户下次签批时会重新生成。" />
        <el-table :data="seals" border>
          <el-table-column prop="name" label="姓名" width="100" />
          <el-table-column prop="number" label="学工号" width="110" />
          <el-table-column label="签章状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.hasSeal ? 'success' : 'info'" size="small">{{ row.hasSeal ? '已生成' : '未生成' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="subject" label="证书主体" min-width="240" />
          <el-table-column label="证书指纹" min-width="200">
            <template #default="{ row }"><code>{{ row.fingerprint ? row.fingerprint.slice(0, 24) + '…' : '—' }}</code></template>
          </el-table-column>
          <el-table-column prop="createdAt" label="生成时间" width="170" />
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="warning" plain :disabled="!row.hasSeal" @click="resetSeal(row)">重置签章</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 用户弹窗 -->
    <el-dialog v-model="userDialog" :title="editingUser ? '编辑用户' : '新建用户'" width="560px">
      <el-form label-width="110px">
        <el-form-item label="账号"><el-input v-model="uf.username" :disabled="Boolean(editingUser)" /></el-form-item>
        <el-form-item v-if="!editingUser" label="初始密码"><el-input v-model="uf.password" show-password /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="uf.name" /></el-form-item>
        <el-form-item label="学工号"><el-input v-model="uf.number" /></el-form-item>
        <el-form-item label="部门">
          <el-select v-model="uf.departmentId" style="width: 100%">
            <el-option v-for="d in departments" :key="d.deptId" :label="d.name" :value="d.deptId" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色（权限组）">
          <el-select v-model="uf.roles" multiple style="width: 100%">
            <el-option v-for="r in roles" :key="r.key" :label="`${r.name}（${r.key}）`" :value="r.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户组">
          <el-input v-model="uf.group" placeholder="如：学工处-审核组（可作为审批人规则）" />
        </el-form-item>
        <el-form-item v-if="editingUser" label="状态">
          <el-switch v-model="uf.status" active-value="active" inactive-value="disabled" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialog = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- 角色弹窗 -->
    <el-dialog v-model="roleDialog" title="新建角色" width="480px">
      <el-form label-width="90px">
        <el-form-item label="Key"><el-input v-model="rf.key" placeholder="小写字母开头，如 auditor" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="rf.name" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="rf.desc" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog = false">取消</el-button>
        <el-button type="primary" @click="createRole">创建</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';

const tab = ref('users');
const users = ref<any[]>([]);
const roles = ref<any[]>([]);
const departments = ref<any[]>([]);
const apikeys = ref<any[]>([]);
const uKeyword = ref('');

const filteredUsers = computed(() => {
  const k = uKeyword.value.trim().toLowerCase();
  if (!k) return users.value;
  return users.value.filter((u) => `${u.name}${u.username}${u.department}${u.group ?? ''}`.toLowerCase().includes(k));
});

const roleName = (key: string) => roles.value.find((r) => r.key === key)?.name ?? key;
const refresh = async () => {
  users.value = await api('get', '/system/users');
  roles.value = await api('get', '/system/roles');
  departments.value = await api('get', '/system/departments');
  apikeys.value = await api('get', '/system/apikeys');
};
onMounted(refresh);

// ---- 用户 ----
const userDialog = ref(false);
const editingUser = ref<any>(null);
const uf = reactive({ username: '', password: '', name: '', number: '', departmentId: undefined as number | undefined, roles: [] as string[], group: '', status: 'active' });

function openUserDialog(row?: any) {
  editingUser.value = row ?? null;
  Object.assign(uf, {
    username: row?.username ?? '', password: '', name: row?.name ?? '', number: row?.number ?? '',
    departmentId: row?.departmentId, roles: row?.roles ?? [], group: row?.group ?? '', status: row?.status ?? 'active',
  });
  userDialog.value = true;
}

async function saveUser() {
  if (editingUser.value) {
    await api('put', `/system/users/${editingUser.value.id}`, {
      name: uf.name, number: uf.number, roles: uf.roles, group: uf.group, departmentId: uf.departmentId, status: uf.status,
    });
    ElMessage.success('已保存');
  } else {
    if (!uf.username || !uf.password || !uf.name || !uf.departmentId) return ElMessage.warning('账号/密码/姓名/部门必填');
    await api('post', '/system/users', { username: uf.username, password: uf.password, name: uf.name, number: uf.number, departmentId: uf.departmentId, roles: uf.roles, group: uf.group });
    ElMessage.success('用户已创建');
  }
  userDialog.value = false;
  refresh();
}

async function resetPwd(row: any) {
  const { value } = await ElMessageBox.prompt(`为「${row.name}」设置新密码（至少 6 位）：`, '重置密码', { inputPlaceholder: '新密码' });
  await api('post', `/system/users/${row.id}/reset-password`, { password: value });
  ElMessage.success('密码已重置');
}

async function toggleUser(row: any) {
  await api('put', `/system/users/${row.id}`, { status: row.status === 'disabled' ? 'active' : 'disabled' });
  ElMessage.success(row.status === 'disabled' ? '已启用' : '已禁用');
  refresh();
}

async function deleteUser(row: any) {
  await ElMessageBox.confirm(`确定删除用户「${row.name}」？有流程记录的用户无法删除（请改用禁用）。`, '提示', { type: 'warning' });
  try {
    await api('delete', `/system/users/${row.id}`);
    ElMessage.success('已删除');
    refresh();
  } catch (e: any) {
    ElMessage.error(e.message);
  }
}

// ---- 角色 ----
const roleDialog = ref(false);
const rf = reactive({ key: '', name: '', desc: '' });

async function createRole() {
  if (!rf.key || !rf.name) return ElMessage.warning('Key 与名称必填');
  await api('post', '/system/roles', { ...rf });
  ElMessage.success('角色已创建，可在用户编辑中分配');
  roleDialog.value = false;
  rf.key = ''; rf.name = ''; rf.desc = '';
  refresh();
}

async function deleteRole(row: any) {
  await ElMessageBox.confirm(`确定删除角色「${row.name}」？`, '提示', { type: 'warning' });
  try {
    await api('delete', `/system/roles/${row.key}`);
    ElMessage.success('已删除');
    refresh();
  } catch (e: any) {
    ElMessage.error(e.message);
  }
}

// ---- 部门 ----
const newDeptName = ref('');
const editingDept = ref<number | null>(null);
const deptEditName = ref('');

async function createDept() {
  if (!newDeptName.value) return ElMessage.warning('请填写部门名称');
  await api('post', '/system/departments', { name: newDeptName.value });
  newDeptName.value = '';
  ElMessage.success('部门已创建');
  refresh();
}

async function saveDept(row: any) {
  await api('put', `/system/departments/${row.id}`, { name: deptEditName.value });
  editingDept.value = null;
  ElMessage.success('已重命名（用户部门名同步更新）');
  refresh();
}

// ---- 个人签章 ----
const seals = ref<any[]>([]);

async function loadSeals() {
  seals.value = await api('get', '/system/seals');
}

async function resetSeal(row: any) {
  await ElMessageBox.confirm(
    `确定重置「${row.name}」的个人签章？已产生的审批签名仍有效，但后续签批将使用新证书。`, '重置签章', { type: 'warning' },
  );
  await api('post', `/system/seals/${row.uid}/reset`);
  ElMessage.success('签章已重置');
  loadSeals();
}

watch(tab, (t) => { if (t === 'seals') loadSeals(); });

// ---- API 密钥 ----
const newKeyName = ref('');

async function createKey() {
  if (!newKeyName.value) return ElMessage.warning('请填写密钥用途');
  const k = await api<{ key: string }>('post', '/system/apikeys', { name: newKeyName.value });
  newKeyName.value = '';
  refresh();
  await ElMessageBox.alert(
    `<p>密钥：<code style="user-select:all">${k.key}</code></p><p style="color:#e6a23c">完整密钥仅展示这一次，请立即复制保存！</p>`,
    'API Key 已生成', { dangerouslyUseHTMLString: true },
  );
}

async function toggleKey(row: any) {
  await api('post', `/system/apikeys/${row.id}/toggle`);
  refresh();
}

async function deleteKey(row: any) {
  await ElMessageBox.confirm(`确定删除密钥「${row.name}」？`, '提示', { type: 'warning' });
  await api('delete', `/system/apikeys/${row.id}`);
  refresh();
}
</script>
