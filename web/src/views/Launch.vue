<template>
  <el-card v-if="info">
    <h3 style="margin-top: 0">{{ info.app.name }} · 办理</h3>
    <p style="color: #909399; margin-top: 0">{{ info.app.desc }}</p>

    <FormRender :components="info.form.components" :data="data" mode="edit" />

    <el-form-item v-if="info.nextChoose" :label="'指定「' + info.nextNodeName + '」审批人'" required>
      <UserMultiSelect v-model="chosen" :users="users" placeholder="选择审批人（限候选人范围）" />
    </el-form-item>

    <div style="margin-top: 12px">
      <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      <el-button @click="$router.back()">取消</el-button>
    </div>
  </el-card>

  <el-dialog v-model="errVisible" title="表单校验未通过" width="480px">
    <ul>
      <li v-for="f in fieldErrors" :key="f.key"><b>{{ f.label }}</b>：{{ f.message }}</li>
    </ul>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, apiRaw } from '../api';
import FormRender from '../components/FormRender.vue';
import UserMultiSelect from '../components/UserMultiSelect.vue';

const route = useRoute();
const router = useRouter();
const info = ref<any>(null);
const data = reactive<Record<string, any>>({});
const users = ref<any[]>([]);
const chosen = ref<number[]>([]);
const submitting = ref(false);
const errVisible = ref(false);
const fieldErrors = ref<{ key: string; label: string; message: string }[]>([]);

onMounted(async () => {
  info.value = await api('get', `/site/app/${route.params.appId}/start-info`);
  // 候选人范围由后端按流程配置过滤；未配置范围时用全量用户
  users.value = info.value.nextCandidates ?? await api('get', '/site/user/options');
});

async function submit() {
  submitting.value = true;
  try {
    const resp = await apiRaw<{ instanceId: number }>('post', '/site/instance/launch', {
      appId: Number(route.params.appId),
      data,
      nextAssignees: chosen.value,
    });
    if (resp.e === 10049) {
      fieldErrors.value = resp.d ?? [];
      errVisible.value = true;
      return;
    }
    if (resp.e !== 0) throw new Error(resp.m);
    ElMessage.success('提交成功');
    router.push('/instance/' + resp.d.instanceId);
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    submitting.value = false;
  }
}
</script>
