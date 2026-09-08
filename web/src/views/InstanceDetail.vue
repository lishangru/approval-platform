<template>
  <el-card v-if="d">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h3 style="margin: 0">{{ d.instance.name }}（#{{ d.instance.id }}）</h3>
      <div>
        <el-tag :type="statusType(d.instance.status)" size="large">{{ statusName(d.instance.status) }}</el-tag>
        <el-button v-if="atStart" type="warning" style="margin-left: 10px" @click="resubmitVisible = true">修改并重新提交</el-button>
        <template v-if="canForce">
          <el-button type="success" style="margin-left: 10px" @click="force('approve')">强制通过</el-button>
          <el-button type="danger" @click="force('reject')">强制退回</el-button>
        </template>
      </div>
    </div>

    <FlowChart :nodes="d.flow.nodes" :edges="d.flow.edges" />

    <el-tabs>
      <el-tab-pane label="表单内容">
        <FormRender :components="d.form.components" :data="d.form.data" mode="readonly" />
      </el-tab-pane>
      <el-tab-pane label="审批记录">
        <LogList :logs="d.logs" />
      </el-tab-pane>
      <el-tab-pane label="流程变量">
        <el-descriptions v-if="vars.length" :column="2" border>
          <el-descriptions-item v-for="v in vars" :key="v.key" :label="v.name">{{ Array.isArray(v.value) ? v.value.join('、') : String(v.value) }}</el-descriptions-item>
        </el-descriptions>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="resubmitVisible" title="修改并重新提交" width="640px">
    <FormRender :components="editableComponents" :data="draftData" mode="edit" />
    <el-form v-if="d.nextChoose" label-width="140px" style="margin-top: 8px">
      <el-form-item label="指定审批人" required>
        <el-select v-model="resubmitAssignees" multiple filterable placeholder="选择下一节点审批人（限候选人范围）" style="width: 360px">
          <el-option v-for="u in d.nextCandidates ?? users" :key="u.id" :label="`${u.name}（${u.department}）`" :value="u.id" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="resubmitVisible = false">取消</el-button>
      <el-button type="primary" @click="doResubmit">重新提交</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, apiRaw } from '../api';
import FormRender from '../components/FormRender.vue';
import FlowChart from '../components/FlowChart.vue';
import LogList from '../components/LogList.vue';
import { isAdmin } from '../store';

const route = useRoute();
const d = ref<any>(null);
const vars = ref<any[]>([]);
const resubmitVisible = ref(false);
const resubmitAssignees = ref<number[]>([]);
const users = ref<any[]>([]);
const draftData = reactive<Record<string, any>>({});

const atStart = computed(() => d.value?.flow?.nodes?.some((n: any) => n.id === 'start' && n.state === 'current'));
const canForce = computed(() => Boolean(isAdmin.value && d.value?.instance?.status === 'running' && d.value?.currentAllowForce));

async function force(action: 'approve' | 'reject') {
  const tip = action === 'approve' ? '强制通过当前节点全部待办，流程将直接进入下一环节' : '强制退回将直接终结该申请（状态变为已否决）';
  const { value } = await ElMessageBox.prompt(`管理员强制审批：${tip}。请输入操作备注：`, '强制审批', {
    confirmButtonText: '确认执行', cancelButtonText: '取消', inputValue: '',
    inputPlaceholder: '备注（写入审批日志，便于审计）',
  });
  const resp = await apiRaw<{ instanceId: number }>('post', `/site/instance/${route.params.id}/force`, { action, comment: value });
  if (resp.e !== 0) return ElMessage.error(resp.m);
  ElMessage.success(action === 'approve' ? '已强制通过' : '已强制退回');
  refresh();
}
const editableComponents = computed(() =>
  (d.value?.form?.components ?? []).map((c: any) => ({ ...c, auth: c.auth === 'forbidden' ? 'forbidden' : 'writable' })),
);

const refresh = async () => {
  d.value = await api('get', `/site/instance/${route.params.id}/detail`);
  Object.assign(draftData, d.value.form.data);
  users.value = await api('get', '/site/user/options');
  try { vars.value = await api('get', `/site/instance/${route.params.id}/variables`); } catch { /* ignore */ }
};
onMounted(refresh);

async function doResubmit() {
  if (d.value.nextChoose && !resubmitAssignees.value.length) return ElMessage.warning('请指定审批人');
  const resp = await apiRaw<{ instanceId: number }>('post', `/site/instance/${route.params.id}/resubmit`, {
    data: draftData,
    nextAssignees: resubmitAssignees.value,
  });
  if (resp.e !== 0) return ElMessage.error(resp.e === 10049 ? (resp.d ?? []).map((x: any) => `${x.label}：${x.message}`).join('；') : resp.m);
  resubmitVisible.value = false;
  ElMessage.success('已重新提交');
  refresh();
}

const statusName = (s: string) => ({ draft: '草稿', running: '进行中', finished: '已完成', revoked: '已撤销', rejected: '已否决' }[s] ?? s);
const statusType = (s: string) => ({ finished: 'success', rejected: 'danger', revoked: 'info', running: 'primary' }[s] ?? 'warning');
</script>
