<template>
  <el-card>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <h3 style="margin: 0">流程设计 · 事项 #{{ appId }}</h3>
      <div>
        <el-select v-model="versionId" placeholder="历史版本" style="width: 200px; margin-right: 8px" @change="loadVersion">
          <el-option v-for="v in versions" :key="v.id" :label="`#${v.id} ${v.version}（${v.status}）`" :value="v.id" />
        </el-select>
        <el-button @click="saveDraft">保存草稿</el-button>
        <el-button type="success" plain @click="publish">发布此版本</el-button>
        <el-button type="primary" @click="addNode">+ 添加审批节点</el-button>
      </div>
    </div>

    <el-table :data="taskNodes" border>
      <el-table-column prop="id" label="节点 ID" width="140" />
      <el-table-column prop="name" label="名称" width="150" />
      <el-table-column label="审批人规则" min-width="160">
        <template #default="{ row }">
          {{ assigneeName(row) }}{{ row.assignee?.dealMode === 'all' ? ' · 会签' : ' · 或签' }}
        </template>
      </el-table-column>
      <el-table-column label="开放动作" min-width="150">
        <template #default="{ row }">{{ (row.actions ?? []).map((a: any) => a.name).join('、') || '—' }}</template>
      </el-table-column>
      <el-table-column label="条件路由" min-width="150">
        <template #default="{ row }">{{ condName(row) }}</template>
      </el-table-column>
      <el-table-column label="强制审批" width="90">
        <template #default="{ row }">
          <el-tag :type="row.allowForce ? 'warning' : 'info'" size="small">{{ row.allowForce ? '允许' : '禁止' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row, $index }">
          <el-button size="small" @click="editNode(row, $index)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="taskNodes.splice($index, 1)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <p style="color: #909399; font-size: 12px">
      发起（start）与结束（end）节点自动维护；审批节点按上表顺序线性串联。「允许强制审批」= 管理员可在该节点强行通过/退回（发布时也可全局覆盖）。
    </p>

    <el-divider>发起节点 · 填写权限</el-divider>
    <el-table :data="startRows" border size="small" style="max-width: 640px">
      <el-table-column prop="label" label="字段" width="160" />
      <el-table-column prop="key" label="Key" width="150" />
      <el-table-column label="发起时权限" min-width="160">
        <template #default="{ row }">
          <el-select v-model="row.auth" size="small">
            <el-option label="必填" value="require" />
            <el-option label="可写" value="writable" />
            <el-option label="隐藏" value="forbidden" />
          </el-select>
        </template>
      </el-table-column>
    </el-table>
    <p style="color: #909399; font-size: 12px">审批节点对字段默认只读，可在各节点编辑里的"字段权限"中调整。</p>

    <el-divider>发起节点 · 后续逻辑</el-divider>
    <el-form label-width="110px" style="max-width: 720px">
      <el-form-item label="路由模式">
        <el-radio-group v-model="startRoute.useCondition">
          <el-radio :value="false">顺序（进入第一个审批节点）</el-radio>
          <el-radio :value="true">条件分支</el-radio>
        </el-radio-group>
      </el-form-item>
      <template v-if="startRoute.useCondition">
        <el-form-item v-for="(c, i) in startRoute.conditions" :key="i" :label="i === 0 ? '条件（且）' : ''" :label-width="i === 0 ? '110px' : '0px'">
          <div class="cond-row">
            <el-select v-model="c.key" placeholder="表单字段" size="small" style="width: 190px">
              <el-option v-for="f in formComponents" :key="f.key" :label="`${f.label}（${f.key}）`" :value="f.key" />
            </el-select>
            <el-select v-model="c.op" size="small" style="width: 96px">
              <el-option label="等于" value="==" /><el-option label="不等于" value="!=" />
              <el-option label="大于" value=">" /><el-option label="大于等于" value=">=" />
              <el-option label="小于" value="<" /><el-option label="小于等于" value="<=" />
            </el-select>
            <el-input v-model="c.value" size="small" placeholder="比较值" style="width: 130px" />
            <el-button size="small" text type="danger" @click="startRoute.conditions.splice(i, 1)">删除</el-button>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <el-button size="small" @click="startRoute.conditions.push({ key: '', op: '==', value: '' })">+ 添加条件</el-button>
        </el-form-item>
        <el-form-item label="满足时去向">
          <el-select v-model="startRoute.whenTo" style="width: 240px">
            <el-option v-for="n in allNodes" :key="n" :label="nodeName(n)" :value="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="兜底去向">
          <el-select v-model="startRoute.fallback" style="width: 240px">
            <el-option v-for="n in allNodes" :key="n" :label="nodeName(n)" :value="n" />
          </el-select>
        </el-form-item>
        <p style="color: #909399; font-size: 12px; margin: 0">例：预计时长 ≥ 24 小时 → 直达"学工处审核"；否则 → "部门负责人审批"。</p>
      </template>
    </el-form>
  </el-card>

  <el-dialog v-model="editVisible" :title="editingIdx >= 0 ? '编辑节点' : '添加节点'" width="760px">
    <el-form label-width="110px">
      <el-form-item label="节点 ID"><el-input v-model="nf.id" :disabled="editingIdx >= 0" placeholder="UserTask_x" /></el-form-item>
      <el-form-item label="节点名称"><el-input v-model="nf.name" /></el-form-item>
      <el-form-item label="审批人规则">
        <el-select v-model="nf.assigneeKind" style="width: 220px">
          <el-option label="发起人所在部门主管" value="dept_leader" />
          <el-option label="固定角色" value="role" />
          <el-option label="用户组" value="group" />
          <el-option label="指定人员" value="fixed" />
          <el-option label="发起人指定" value="initiator_choose" />
        </el-select>
        <el-input v-if="nf.assigneeKind === 'role'" v-model="nf.roleValue" placeholder="角色 key，如 office" style="width: 170px; margin-left: 8px" />
        <el-select v-if="nf.assigneeKind === 'group'" v-model="nf.groupValue" placeholder="选择用户组" style="width: 220px; margin-left: 8px">
          <el-option v-for="g in groups" :key="g" :label="`${g}（${users.filter((u) => u.group === g).length}人）`" :value="g" />
        </el-select>
        <el-select v-if="nf.assigneeKind === 'fixed'" v-model="nf.fixedUids" multiple style="width: 240px; margin-left: 8px">
          <el-option v-for="u in users" :key="u.id" :label="u.name" :value="u.id" />
        </el-select>
      </el-form-item>
      <template v-if="nf.assigneeKind === 'initiator_choose'">
        <el-form-item label="候选人范围">
          <el-select v-model="nf.chooseScopeKind" style="width: 220px">
            <el-option label="全部人员" value="all" />
            <el-option label="固定角色" value="role" />
            <el-option label="用户组" value="group" />
            <el-option label="指定部门" value="department" />
            <el-option label="指定人员" value="fixed" />
          </el-select>
          <span style="color: #909399; font-size: 12px; margin-left: 8px">发起人只能在该范围内指定审批人</span>
        </el-form-item>
        <el-form-item v-if="nf.chooseScopeKind === 'role'" label="范围值">
          <el-input v-model="nf.chooseScopeRole" placeholder="角色 key，如 office" style="width: 220px" />
        </el-form-item>
        <el-form-item v-if="nf.chooseScopeKind === 'group'" label="范围值">
          <el-select v-model="nf.chooseScopeGroup" placeholder="选择用户组" style="width: 220px">
            <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="nf.chooseScopeKind === 'department'" label="范围值">
          <el-select v-model="nf.chooseScopeDept" placeholder="选择部门" style="width: 220px">
            <el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="nf.chooseScopeKind === 'fixed'" label="范围值">
          <el-select v-model="nf.chooseScopeFixed" multiple filterable placeholder="选择可被指定的人员" style="width: 340px">
            <el-option v-for="u in users" :key="u.id" :label="`${u.name}（${u.department}）`" :value="u.id" />
          </el-select>
        </el-form-item>
      </template>
      <el-form-item label="处理模式">
        <el-radio-group v-model="nf.dealMode">
          <el-radio value="or">或签（任一人处理）</el-radio>
          <el-radio value="all">会签（全部同意才通过）</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="开放动作">
        <el-checkbox-group v-model="nf.actionCodes">
          <el-checkbox value="approve">同意</el-checkbox>
          <el-checkbox value="reject">退回</el-checkbox>
          <el-checkbox value="delegate">转办</el-checkbox>
          <el-checkbox value="addSign">加签</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="意见必填"><el-switch v-model="nf.opinionRequired" /></el-form-item>
      <el-form-item label="允许强制审批">
        <el-switch v-model="nf.allowForce" />
        <span style="color: #909399; font-size: 12px; margin-left: 8px">管理员可在此节点强行通过/退回</span>
      </el-form-item>

      <el-divider>条件路由（低代码）</el-divider>
      <el-form-item label="启用条件">
        <el-switch v-model="nf.useCondition" />
        <span style="color: #909399; font-size: 12px; margin-left: 8px">满足全部条件 → 走「满足时去向」；否则走兜底去向</span>
      </el-form-item>
      <template v-if="nf.useCondition">
        <el-form-item v-for="(c, i) in nf.conditions" :key="i" :label="i === 0 ? '条件（且）' : ''" :label-width="i === 0 ? '110px' : '0px'">
          <div class="cond-row">
            <el-select v-model="c.key" placeholder="表单字段" style="width: 190px">
              <el-option v-for="f in formComponents" :key="f.key" :label="`${f.label}（${f.key}）`" :value="f.key" />
            </el-select>
            <el-select v-model="c.op" style="width: 110px">
              <el-option label="等于" value="==" />
              <el-option label="不等于" value="!=" />
              <el-option label="大于" value=">" />
              <el-option label="大于等于" value=">=" />
              <el-option label="小于" value="<" />
              <el-option label="小于等于" value="<=" />
            </el-select>
            <el-input v-model="c.value" placeholder="比较值" style="width: 140px" />
            <el-button type="danger" text @click="nf.conditions.splice(i, 1)">删除</el-button>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <el-button size="small" @click="nf.conditions.push({ key: '', op: '==', value: '' })">+ 添加条件</el-button>
        </el-form-item>
        <el-form-item label="满足时去向">
          <el-select v-model="nf.whenTo" style="width: 240px">
            <el-option v-for="n in allNodes" :key="n" :label="nodeName(n)" :value="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="兜底去向">
          <el-select v-model="nf.fallback" style="width: 240px">
            <el-option v-for="n in allNodes" :key="n" :label="nodeName(n)" :value="n" />
          </el-select>
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item label="下一节点">
          <el-select v-model="nf.next" style="width: 240px">
            <el-option v-for="n in allNodes" :key="n" :label="nodeName(n)" :value="n" />
          </el-select>
          <span style="color: #909399; font-size: 12px; margin-left: 8px">默认按列表顺序串联，可显式指定</span>
        </el-form-item>
      </template>

      <el-divider>字段权限（本节点对表单字段的控制）</el-divider>
      <el-table :data="authRows" border size="small">
        <el-table-column prop="label" label="字段" width="160" />
        <el-table-column prop="key" label="Key" width="150" />
        <el-table-column label="权限" min-width="160">
          <template #default="{ row }">
            <el-select v-model="row.auth" size="small">
              <el-option label="必填" value="require" />
              <el-option label="可写" value="writable" />
              <el-option label="只读" value="readable" />
              <el-option label="隐藏" value="forbidden" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
    </el-form>
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" @click="saveNode">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const route = useRoute();
const appId = Number(route.params.appId);
const nodes = ref<any[]>([]);
const versions = ref<any[]>([]);
const versionId = ref<number>();
const users = ref<any[]>([]);
const formComponents = ref<any[]>([]);
const latestFormVerId = ref<number | null>(null);
const editVisible = ref(false);
const editingIdx = ref(-1);

const nf = reactive({
  id: '', name: '', assigneeKind: 'dept_leader', roleValue: '', groupValue: '', fixedUids: [] as number[],
  chooseScopeKind: 'all', chooseScopeRole: '', chooseScopeGroup: '', chooseScopeDept: undefined as number | undefined, chooseScopeFixed: [] as number[],
  dealMode: 'or', actionCodes: ['approve'] as string[], opinionRequired: false, allowForce: false,
  useCondition: false, conditions: [] as { key: string; op: string; value: string }[],
  whenTo: 'end', fallback: 'end', next: 'end',
});

const taskNodes = computed(() => nodes.value.filter((n) => n.kind === 'userTask'));
const allNodes = computed(() => [...taskNodes.value.map((n) => n.id), 'end']);
const authRows = ref<{ key: string; label: string; auth: string }[]>([]);
const startRows = ref<{ key: string; label: string; auth: string }[]>([]);
const startRoute = reactive({
  useCondition: false,
  conditions: [{ key: '', op: '==', value: '' }] as { key: string; op: string; value: string }[],
  whenTo: 'end', fallback: 'end',
});
const groups = computed(() => [...new Set(users.value.map((u) => u.group).filter(Boolean))] as string[]);
const departments = computed(() => {
  const seen = new Map<number, string>();
  for (const u of users.value) if (u.departmentId != null && !seen.has(u.departmentId)) seen.set(u.departmentId, u.department);
  return [...seen].map(([id, name]) => ({ id, name }));
});
const nodeName = (id: string) => (id === 'end' ? '结束' : taskNodes.value.find((n) => n.id === id)?.name ?? id);

const refresh = async () => {
  const [vers, us, forms, apps] = await Promise.all([
    api<any[]>('get', `/system/flow?appId=${appId}`),
    api<any[]>('get', '/system/users').catch(() => []),
    api<any[]>('get', `/system/form?appId=${appId}`),
    api<any[]>('get', '/system/app'),
  ]);
  versions.value = vers; users.value = us;
  const publishedForm = forms.filter((f) => f.status === 'published').sort((a, b) => b.id - a.id)[0];
  if (publishedForm) { formComponents.value = publishedForm.snapshot.components; latestFormVerId.value = publishedForm.id; }
  latestFormVerId.value = latestFormVerId.value ?? apps.find((a) => a.id === appId)?.formVersionId ?? null;
  if (forms.length && !formComponents.value.length) formComponents.value = forms[0].snapshot.components;
  if (versions.value.length && !versionId.value) { versionId.value = versions.value[0].id; loadVersion(); }
};
onMounted(refresh);

async function loadVersion() {
  const v = versions.value.find((x) => x.id === versionId.value);
  nodes.value = v ? JSON.parse(JSON.stringify(v.snapshot.nodes)) : [];
  const startNode = nodes.value.find((n) => n.kind === 'start');
  const formId = Object.keys(startNode?.draftAuths ?? {})[0];
  const matrix = startNode?.draftAuths?.[formId] ?? {};
  startRows.value = formComponents.value.map((c) => ({ key: c.key, label: c.label, auth: matrix[c.key] ?? 'writable' }));
  // 发起节点路由
  const sr = startNode?.routing;
  startRoute.useCondition = sr?.kind === 'conditional';
  startRoute.conditions = sr?.kind === 'conditional' ? parseConditions(sr.branches?.[0]?.when) : [{ key: '', op: '==', value: '' }];
  startRoute.whenTo = sr?.kind === 'conditional' ? (sr.branches?.[0]?.to ?? 'end') : 'end';
  startRoute.fallback = sr?.kind === 'conditional' ? (sr.fallback ?? 'end') : 'end';
}

const assigneeName = (row: any) => ({ dept_leader: '部门主管', role: `角色:${row.assignee?.value}`, group: `用户组:${row.assignee?.value}`, fixed: '指定人员', initiator_choose: '发起人指定', initiator: '发起人' }[row.assignee?.kind] ?? '未配置');
const condName = (row: any) => {
  const r = row.routing ?? {};
  if (r.kind === 'conditional') return `${r.branches?.[0]?.when ? '有条件' : '无条件'}→${nodeName(r.branches?.[0]?.to ?? 'end')}，否则→${nodeName(r.fallback ?? 'end')}`;
  return r.next ? `顺序→${nodeName(r.next)}` : '顺序（按列表串联）';
};

function addNode() {
  editingIdx.value = -1;
  Object.assign(nf, {
    id: 'UserTask_' + Math.random().toString(36).slice(2, 7), name: '',
    assigneeKind: 'dept_leader', roleValue: '', groupValue: '', fixedUids: [], dealMode: 'or',
    chooseScopeKind: 'all', chooseScopeRole: '', chooseScopeGroup: '', chooseScopeDept: undefined, chooseScopeFixed: [],
    actionCodes: ['approve'], opinionRequired: false, allowForce: false,
    useCondition: false, conditions: [{ key: '', op: '==', value: '' }],
    whenTo: 'end', fallback: 'end', next: '',
  });
  authRows.value = formComponents.value.map((c) => ({ key: c.key, label: c.label, auth: 'readable' }));
  editVisible.value = true;
}

// —— 低代码条件 <-> 表达式 互转 ——
const NUM_OPS = ['>', '>=', '<', '<='];
function compileConditions(rows: { key: string; op: string; value: string }[]): any | undefined {
  const valid = rows.filter((r) => r.key && r.value !== '');
  if (!valid.length) return undefined;
  const toExpr = (r: { key: string; op: string; value: string }) => [
    { var: 'form.' + r.key },
    NUM_OPS.includes(r.op) ? Number(r.value) : r.value,
  ];
  const one = (r: { key: string; op: string; value: string }) => ({ [r.op]: toExpr(r) });
  return valid.length === 1 ? one(valid[0]) : { and: valid.map(one) };
}
function parseConditions(expr: any): { key: string; op: string; value: string }[] {
  if (!expr || typeof expr !== 'object') return [{ key: '', op: '==', value: '' }];
  const flat = (e: any): any[] => (e.and ? e.and.flatMap(flat) : [e]);
  return flat(expr).map((e: any) => {
    const [op, args] = Object.entries(e)[0] as [string, any[]];
    const key = String(args[0]?.var ?? '').replace(/^form\./, '');
    return { key, op, value: String(args[1] ?? '') };
  });
}

function editNode(row: any, idx: number) {
  editingIdx.value = idx;
  const r = row.routing ?? {};
  const isCond = r.kind === 'conditional';
  Object.assign(nf, {
    id: row.id, name: row.name,
    assigneeKind: row.assignee?.kind ?? 'dept_leader',
    roleValue: row.assignee?.kind === 'role' ? String(row.assignee?.value ?? '') : '',
    groupValue: row.assignee?.kind === 'group' ? String(row.assignee?.value ?? '') : '',
    fixedUids: row.assignee?.kind === 'fixed' ? (row.assignee?.value as number[] ?? []) : [],
    chooseScopeKind: row.assignee?.scope?.kind ?? 'all',
    chooseScopeRole: row.assignee?.scope?.kind === 'role' ? String(row.assignee.scope.value ?? '') : '',
    chooseScopeGroup: row.assignee?.scope?.kind === 'group' ? String(row.assignee.scope.value ?? '') : '',
    chooseScopeDept: row.assignee?.scope?.kind === 'department' ? Number(row.assignee.scope.value) : undefined,
    chooseScopeFixed: row.assignee?.scope?.kind === 'fixed' ? (row.assignee.scope.value as number[] ?? []) : [],
    dealMode: row.assignee?.dealMode ?? 'or',
    actionCodes: (row.actions ?? []).map((a: any) => a.code),
    opinionRequired: (row.actions ?? []).some((a: any) => a.opinionRequired),
    allowForce: Boolean(row.allowForce),
    useCondition: Boolean(isCond && r.branches?.[0]?.when),
    conditions: isCond ? parseConditions(r.branches?.[0]?.when) : [{ key: '', op: '==', value: '' }],
    whenTo: r.branches?.[0]?.to ?? 'end',
    fallback: r.fallback ?? 'end',
    next: r.next ?? 'end',
  });
  const formId = Object.keys(row.auths ?? {})[0];
  const matrix = row.auths?.[formId] ?? {};
  authRows.value = formComponents.value.map((c) => ({ key: c.key, label: c.label, auth: matrix[c.key] ?? 'readable' }));
  editVisible.value = true;
}

function saveNode() {
  if (!nf.id || !nf.name) return ElMessage.warning('请填写节点 ID 与名称');
  const assignee: any = { kind: nf.assigneeKind, dealMode: nf.dealMode };
  if (nf.assigneeKind === 'role') assignee.value = nf.roleValue;
  if (nf.assigneeKind === 'group') assignee.value = nf.groupValue;
  if (nf.assigneeKind === 'fixed') assignee.value = nf.fixedUids;
  if (nf.assigneeKind === 'initiator_choose' && nf.chooseScopeKind !== 'all') {
    assignee.scope = {
      kind: nf.chooseScopeKind,
      value: nf.chooseScopeKind === 'role' ? nf.chooseScopeRole
        : nf.chooseScopeKind === 'group' ? nf.chooseScopeGroup
        : nf.chooseScopeKind === 'department' ? nf.chooseScopeDept
        : nf.chooseScopeFixed,
    };
    if (assignee.scope.value === '' || (Array.isArray(assignee.scope.value) && !assignee.scope.value.length) || assignee.scope.value === undefined) {
      return ElMessage.warning('请填写候选人范围');
    }
  }
  const actions = nf.actionCodes.map((code) => ({
    code, name: ({ approve: '同意', reject: '退回修改', delegate: '转办', addSign: '加签' } as any)[code] ?? code,
    ...(code === 'reject' ? { backTo: 'start' } : {}),
    ...(nf.opinionRequired && ['approve', 'reject'].includes(code) ? { opinionRequired: true } : {}),
  }));
  const when = compileConditions(nf.conditions);
  if (nf.useCondition && nf.conditions.some((c) => c.key && c.value !== '') && !when) {
    return ElMessage.warning('条件未填写完整');
  }
  const routing: any = nf.useCondition && when
    ? { kind: 'conditional', branches: [{ when, to: nf.whenTo }], fallback: nf.fallback }
    : { kind: 'sequential', next: nf.next || '' };
  const node: any = {
    id: nf.id, kind: 'userTask', name: nf.name, assignee, actions, routing,
    allowForce: nf.allowForce,
    auths: { [String(latestFormVerId.value ?? 0)]: Object.fromEntries(authRows.value.map((r) => [r.key, r.auth])) },
  };
  if (editingIdx.value >= 0) nodes.value[nodes.value.indexOf(taskNodes.value[editingIdx.value])] = node;
  else nodes.value.push(node);
  editVisible.value = false;
}

async function saveDraft() {
  const ids = taskNodes.value.map((n) => n.id);
  const formVerId = String(latestFormVerId.value ?? 0);
  // 发起节点路由：顺序 或 条件分支（低代码条件）
  let startRouting: any = { kind: 'sequential', next: ids[0] ?? 'end' };
  if (startRoute.useCondition) {
    const when = compileConditions(startRoute.conditions);
    const hasInput = startRoute.conditions.some((c) => c.key && c.value !== '');
    if (hasInput && !when) return ElMessage.warning('发起条件未填写完整');
    if (when) {
      if (!startRoute.whenTo || !startRoute.fallback) return ElMessage.warning('请选择条件分支的去向');
      startRouting = { kind: 'conditional', branches: [{ when, to: startRoute.whenTo }], fallback: startRoute.fallback };
    }
  }
  const built: any[] = [
    {
      id: 'start', kind: 'start', name: '发起', auths: {},
      draftAuths: { [formVerId]: Object.fromEntries(startRows.value.map((r) => [r.key, r.auth])) },
      routing: startRouting,
    },
    ...taskNodes.value.map((n, i) => ({
      ...n,
      routing: n.routing?.kind === 'conditional'
        ? { ...n.routing, fallback: n.routing.fallback ?? 'end' }
        : { kind: 'sequential', next: n.routing?.next && n.routing.next !== '' ? n.routing.next : (ids[i + 1] ?? 'end') },
    })),
    { id: 'end', kind: 'end', name: '结束', auths: {} },
  ];
  await api('post', '/system/flow', { appId, nodes: built, variables: [] }).then((row: any) => { versionId.value = row.id; });
  ElMessage.success(`已保存为版本 #${versionId.value}，点击"发布此版本"生效`);
  refresh();
}

async function publish() {
  if (!versionId.value) return ElMessage.warning('请先保存草稿');
  await api('post', `/system/flow/${versionId.value}/publish`);
  ElMessage.success('版本已发布');
  refresh();
}
</script>

<style scoped>
.cond-row { display: flex; gap: 8px; align-items: center; }
</style>
