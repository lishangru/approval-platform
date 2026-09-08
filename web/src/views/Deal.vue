<template>
  <el-card v-if="d">
    <h3 style="margin-top: 0">
      {{ d.instance.vars?.app_name || '签批' }} · {{ d.node.name }}
      <el-tag v-if="d.task.isSign" type="warning" size="small" style="margin-left: 8px">加签任务</el-tag>
      <el-tag size="small" style="margin-left: 8px">发起人：{{ d.instance.creator }}（{{ d.instance.creatorDepartment }}）</el-tag>
    </h3>

    <FormRender :components="d.form.components" :data="data" :mode="isSign ? 'readonly' : 'edit'" />

    <el-divider />

    <el-form label-width="100px">
      <el-form-item label="审批操作" required>
        <el-radio-group v-model="action">
          <el-radio v-for="a in d.node.actions" :key="a.code" :value="a.code">{{ a.name }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="审批意见">
        <el-input v-model="comment" type="textarea" :rows="3" placeholder="填写审批意见（必填项操作会强制校验）" style="max-width: 560px" />
      </el-form-item>
      <el-form-item label="附件">
        <div>
          <el-upload :file-list="attachList" :http-request="uploadAttach" :on-remove="removeAttach" multiple>
            <el-button>📎 上传附件</el-button>
          </el-upload>
        </div>
      </el-form-item>

      <el-form-item v-if="action === 'delegate'" label="选择代处理人" required>
        <el-select v-model="delegateUid" filterable placeholder="选择转办对象" style="width: 320px">
          <el-option v-for="u in users" :key="u.id" :label="`${u.name}（${u.department}）`" :value="u.id" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="action === 'addSign'" label="选择加签人" required>
        <UserMultiSelect v-model="signUids" :users="users" placeholder="选择加签人" />
      </el-form-item>

      <el-form-item v-if="d.nextChoose" label="指定下一环节审批人" required>
        <div style="width: 100%">
          <UserMultiSelect v-model="nextAssignees" :users="d.nextChoose.candidates" :placeholder="`选择「${d.nextChoose.nodeName}」审批人`" />
          <div v-if="defaultSelectedNames.length" class="chosen-hint">
            发起人指定：<b>{{ defaultSelectedNames.join('、') }}</b>（已默认带入，如需调整可修改）
          </div>
        </div>
      </el-form-item>

      <el-form-item label="知会">
        <UserMultiSelect v-model="readers" :users="users" placeholder="选择知会人员" />
      </el-form-item>
    </el-form>

    <div style="margin-top: 8px">
      <el-button type="primary" :loading="submitting" @click="submit">提 交</el-button>
      <el-button @click="$router.back()">返回</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, apiRaw } from '../api';
import FormRender from '../components/FormRender.vue';
import UserMultiSelect from '../components/UserMultiSelect.vue';

const route = useRoute();
const router = useRouter();
const d = ref<any>(null);
const data = reactive<Record<string, any>>({});
const original = reactive<Record<string, any>>({});
const users = ref<any[]>([]);
const action = ref('');
const comment = ref('');
const delegateUid = ref<number>();
const signUids = ref<number[]>([]);
const nextAssignees = ref<number[]>([]);
const readers = ref<number[]>([]);
const attachments = ref<any[]>([]);
const submitting = ref(false);

const attachList = computed(() => attachments.value.map((f, i) => ({ name: f.name, uid: i })));
async function uploadAttach(opt: any) {
  try {
    const fd = new FormData();
    fd.append('file', opt.file);
    const r = await api('post', '/api/upload', fd);
    attachments.value.push(r);
    opt.onSuccess(r);
  } catch (e: any) {
    ElMessage.error('上传失败：' + e.message);
    opt.onError(e);
  }
}
function removeAttach(f: any) {
  attachments.value.splice(Number(f.uid), 1);
}

const isSign = computed(() => Boolean(d.value?.task?.isSign));

onMounted(async () => {
  d.value = await api('get', `/site/task/${route.params.taskId}/deal-info`);
  Object.assign(original, d.value.data);
  Object.assign(data, JSON.parse(JSON.stringify(d.value.data)));
  action.value = d.value.node.actions[0]?.code ?? '';
  // 发起人指定的人选默认带入（预审人可见、可修改）
  nextAssignees.value = d.value.nextChoose?.selected ?? [];
  users.value = await api('get', '/site/user/options');
});

const defaultSelectedNames = computed(() =>
  (d.value?.nextChoose?.candidates ?? []).filter((c: any) => (d.value?.nextChoose?.selected ?? []).includes(c.id)).map((c: any) => c.name),
);

async function submit() {
  if (d.value.nextChoose && !nextAssignees.value.length) return ElMessage.warning(`请指定「${d.value.nextChoose.nodeName}」的审批人`);
  submitting.value = true;
  try {
    // 只提交可写字段的修改
    const changed: Record<string, any> = {};
    for (const c of d.value.form.components) {
      if ((c.auth === 'writable' || c.auth === 'require') && JSON.stringify(data[c.key]) !== JSON.stringify(original[c.key])) {
        changed[c.key] = data[c.key];
      }
    }
    const param: Record<string, any> = {};
    if (action.value === 'delegate') param.uid = delegateUid.value;
    if (action.value === 'addSign') param.uids = signUids.value;

    const resp = await apiRaw<{ instanceId: number }>('post', `/site/task/${route.params.taskId}/deal`, {
      operation: { code: action.value, param },
      comment: comment.value,
      attachments: attachments.value,
      reader: readers.value,
      data: changed,
      next: nextAssignees.value.length ? { assignees: nextAssignees.value } : undefined,
    });
    if (resp.e === 10049) return ElMessage.error((resp.d ?? []).map((x: any) => `${x.label}：${x.message}`).join('；'));
    if (resp.e !== 0) throw new Error(resp.m);
    ElMessage.success('处理完成');
    router.back();
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.chosen-hint { margin-top: 6px; font-size: 12px; color: #e6a23c; background: #fdf6ec; display: inline-block; padding: 3px 10px; border-radius: 4px; }
</style>
