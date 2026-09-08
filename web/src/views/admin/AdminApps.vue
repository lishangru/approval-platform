<template>
  <h2>事项管理</h2>
  <el-button type="primary" style="margin-bottom: 12px" @click="createVisible = true">新建事项</el-button>
  <el-table :data="apps" border>
    <el-table-column prop="id" label="ID" width="60" />
    <el-table-column prop="name" label="名称" min-width="140" />
    <el-table-column prop="desc" label="描述" min-width="200" />
    <el-table-column label="表单版本" width="110">
      <template #default="{ row }">{{ formVer(row) || '未发布' }}</template>
    </el-table-column>
    <el-table-column label="流程版本" width="110">
      <template #default="{ row }">{{ flowVer(row) || '未发布' }}</template>
    </el-table-column>
    <el-table-column label="操作" width="330" fixed="right">
      <template #default="{ row }">
        <el-button size="small" @click="$router.push('/admin/form/' + row.id)">表单设计</el-button>
        <el-button size="small" @click="$router.push('/admin/flow/' + row.id)">流程设计</el-button>
        <el-button size="small" @click="$router.push('/admin/data/' + row.id)">数据查询</el-button>
        <el-button size="small" type="success" plain :disabled="!row.formVersionId || !row.flowVersionId" @click="openPublish(row)">发布上线</el-button>
      </template>
    </el-table-column>
  </el-table>

  <el-dialog v-model="createVisible" title="新建事项" width="460px">
    <el-form label-width="80px">
      <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="form.desc" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button type="primary" @click="create">创建</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="publishVisible" title="发布上线" width="480px">
    <el-form label-width="90px">
      <el-form-item label="表单版本">
        <el-select v-model="pubFormId" style="width: 100%">
          <el-option v-for="f in pubForms" :key="f.id" :label="`#${f.id} ${f.version}（${f.status}）`" :value="f.id" :disabled="f.status !== 'published'" />
        </el-select>
      </el-form-item>
      <el-form-item label="流程版本">
        <el-select v-model="pubFlowId" style="width: 100%">
          <el-option v-for="f in pubFlows" :key="f.id" :label="`#${f.id} ${f.version}（${f.status}）`" :value="f.id" :disabled="f.status !== 'published'" />
        </el-select>
      </el-form-item>
      <el-form-item label="强制审批">
        <el-switch v-model="pubAllowForce" />
        <span style="color: #909399; font-size: 12px; margin-left: 8px">
          允许后一级（各审批节点）被管理员强制通过/退回（覆盖流程中的逐节点设置）
        </span>
      </el-form-item>
      <el-form-item label="三方选择">
        <el-radio-group v-model="pubAllowForceMode">
          <el-radio value="apply">按上面开关设置</el-radio>
          <el-radio value="keep">保留流程设计中的逐节点设置</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="publishVisible = false">取消</el-button>
      <el-button type="primary" @click="doPublish">发布</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const apps = ref<any[]>([]);
const createVisible = ref(false);
const form = reactive({ name: '', desc: '' });
const publishVisible = ref(false);
const pubForms = ref<any[]>([]);
const pubFlows = ref<any[]>([]);
const pubAppId = ref<number>();
const pubFormId = ref<number>();
const pubFlowId = ref<number>();
const pubAllowForce = ref(false);
const pubAllowForceMode = ref<'apply' | 'keep'>('apply');

const refresh = async () => { apps.value = await api('get', '/system/app'); };
onMounted(refresh);

const formVer = (row: any) => (row.formVersionId ? `#${row.formVersionId}` : '');
const flowVer = (row: any) => (row.flowVersionId ? `#${row.flowVersionId}` : '');

async function create() {
  if (!form.name) return ElMessage.warning('请填写名称');
  await api('post', '/system/app', { name: form.name, desc: form.desc });
  ElMessage.success('已创建，请分别设计表单与流程后发布');
  createVisible.value = false;
  form.name = ''; form.desc = '';
  refresh();
}

async function openPublish(row: any) {
  pubAppId.value = row.id;
  pubForms.value = await api('get', `/system/form?appId=${row.id}`);
  pubFlows.value = await api('get', `/system/flow?appId=${row.id}`);
  // 默认选中"最新的已发布版本"；全部是草稿则提示
  const latestPub = (list: any[]) => list.filter((f) => f.status === 'published').sort((a, b) => b.id - a.id)[0]?.id;
  pubFormId.value = row.formVersionId ?? latestPub(pubForms.value);
  pubFlowId.value = row.flowVersionId ?? latestPub(pubFlows.value);
  if (!pubFormId.value || !pubFlowId.value) {
    ElMessage.warning('该事项的表单/流程版本还没有发布：请先在表单设计、流程设计中保存草稿并点击"发布此版本"');
  }
  pubAllowForceMode.value = 'keep';
  publishVisible.value = true;
}

async function doPublish() {
  const body: any = { formId: pubFormId.value, flowId: pubFlowId.value };
  if (pubAllowForceMode.value === 'apply') body.allowForce = pubAllowForce.value;
  await api('post', `/system/app/${pubAppId.value}/publish`, body);
  ElMessage.success('发布成功，用户可在大厅办理');
  publishVisible.value = false;
  refresh();
}
</script>
