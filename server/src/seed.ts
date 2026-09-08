import { JsonStore } from './core/store.js';
import { WorkflowEngine, type UserRow, type AppRow, type FormRow, type FlowRow, type RoleRow, type DeptRow } from './domain/flow/engine.js';
import { hashPassword, makeSalt } from './services/auth.js';
import type { FieldAuth } from './core/types.js';

// 内置角色（权限组）
export const BUILTIN_ROLES: { key: string; name: string; desc: string }[] = [
  { key: 'admin', name: '超级管理员', desc: '管理端全部权限：事项设计、用户/角色/部门管理、强制审批、数据导出' },
  { key: 'leader', name: '部门负责人', desc: '作为本部门主管参与审批（dept_leader 规则命中）' },
  { key: 'office', name: '学工处审核', desc: '职能审核角色，可按 role:office 配置为审批人' },
  { key: 'school', name: '校级审批', desc: '校级备案/终审角色' },
  { key: 'staff', name: '工作人员', desc: '普通办事人员' },
  { key: 'student', name: '学生', desc: '事项发起人' },
];

// 每次启动都会执行的兜底（老数据自动补齐角色/部门表）
export function ensureBaseData(engine: WorkflowEngine) {
  if (!engine.roles.all().length) {
    for (const r of BUILTIN_ROLES) engine.roles.insert({ id: 0, ...r, builtin: true });
    console.log('[seed] 已写入内置角色:', BUILTIN_ROLES.map((r) => r.key).join(','));
  }
  if (!engine.departments.all().length) {
    const seen = new Map<number, string>();
    for (const u of engine.users.all()) if (u.departmentId != null && !seen.has(u.departmentId)) seen.set(u.departmentId, u.department);
    for (const [deptId, name] of seen) engine.departments.insert({ id: 0, deptId, name });
  }
}

export function seedIfEmpty(engine: WorkflowEngine, store: JsonStore) {
  if (store.exists() && engine.users.all().length) { ensureBaseData(engine); return false; }

  // ===== 用户 =====
  const mkUser = (username: string, pass: string, name: string, number: string, department: string, departmentId: number, roles: string[], group?: string): UserRow => {
    const salt = makeSalt();
    return { id: 0, username, passHash: hashPassword(pass, salt), salt, name, number, department, departmentId, roles, group };
  };
  engine.users.insert(mkUser('admin', 'admin123', '系统管理员', '000000001', '信息化处', 1, ['admin']));
  engine.users.insert(mkUser('lishangru', '123456', '李尚儒', '092410208', '机电学院', 10, ['student'], '机电学院-研究生会'));
  engine.users.insert(mkUser('wangjianguo', '123456', '王建国', '199801001', '机电学院', 10, ['leader'], '机电学院-教授委员会'));
  engine.users.insert(mkUser('zhangmin', '123456', '张敏', '199901002', '学工处', 20, ['leader', 'office'], '学工处-审核组'));
  engine.users.insert(mkUser('liuzhen', '123456', '刘震', '199901004', '学工处', 20, ['staff'], '学工处-审核组'));
  engine.users.insert(mkUser('xiaozhang', '123456', '张校长', '199001003', '校长办公室', 30, ['school'], '校办-值班组'));

  ensureBaseData(engine);

  // ===== 演示事项：会议室预约 =====
  const app: AppRow = engine.apps.insert({
    id: 0, name: '会议室预约', desc: '预约学校会议室，超过4小时需校级备案', icon: 'meeting',
    formVersionId: null, flowVersionId: null,
  });

  const form: FormRow = engine.forms.insert({
    id: 0, appId: app.id, version: 'v1', status: 'draft',
    snapshot: {
      components: [
        { type: 'input', key: 'Input_1', label: '会议主题', props: { placeholder: '请输入会议主题', maxLength: 50 } },
        { type: 'radio', key: 'Radio_2', label: '是否需要投影设备', props: { options: [{ name: '需要', value: 'yes' }, { name: '不需要', value: 'no' }] } },
        { type: 'calendar', key: 'Calendar_3', label: '使用日期', props: { dateOnly: true } },
        { type: 'integer', key: 'Integer_4', label: '使用时长（小时）', props: { min: 1, max: 12 } },
        { type: 'integer', key: 'Integer_5', label: '参会人数', props: { min: 1, max: 200 } },
        { type: 'textarea', key: 'Textarea_6', label: '事由说明', props: { placeholder: '请简要说明会议事由' } },
        { type: 'multiInput', key: 'MultiInput_7', label: '设备需求清单', props: { maxCount: 5 }, visibleIf: { '==': [{ var: 'form.Radio_2' }, 'yes'] } },
      ],
    },
  });

  const F = String(form.id);
  const draftAuths: Record<string, Record<string, FieldAuth>> = {
    [F]: { Input_1: 'require', Radio_2: 'require', Calendar_3: 'require', Integer_4: 'require', Integer_5: 'require', Textarea_6: 'require', MultiInput_7: 'writable' },
  };
  const readonly: Record<string, FieldAuth> = {
    Input_1: 'readable', Radio_2: 'readable', Calendar_3: 'readable', Integer_4: 'readable', Integer_5: 'readable', Textarea_6: 'readable', MultiInput_7: 'readable',
  };
  const writableTime: Record<string, FieldAuth> = { ...readonly, Integer_4: 'writable' };

  const flow: FlowRow = engine.flows.insert({
    id: 0, appId: app.id, version: 'v1', status: 'draft',
    snapshot: {
      variables: [
        { key: 'user_name', name: '发起人姓名', source: 'user' },
        { key: 'user_department', name: '发起人部门', source: 'user' },
        { key: 'node_name', name: '当前节点', source: 'custom' },
      ],
      nodes: [
        {
          id: 'start', kind: 'start', name: '发起', auths: {}, draftAuths,
          routing: { kind: 'sequential', next: 'UserTask_1' },
        },
        {
          id: 'UserTask_1', kind: 'userTask', name: '部门负责人审批',
          assignee: { kind: 'dept_leader', dealMode: 'or' },
          auths: { [F]: readonly },
          allowForce: true,
          actions: [
            { code: 'approve', name: '同意' },
            { code: 'reject', name: '退回修改', backTo: 'start', opinionRequired: true },
            { code: 'delegate', name: '转办' },
            { code: 'addSign', name: '加签' },
          ],
          routing: { kind: 'sequential', next: 'UserTask_2' },
        },
        {
          id: 'UserTask_2', kind: 'userTask', name: '学工处审核',
          assignee: { kind: 'role', value: 'office', dealMode: 'or' },
          auths: { [F]: writableTime },
          allowForce: true,
          actions: [
            { code: 'approve', name: '审核通过', opinionRequired: true },
            { code: 'reject', name: '退回修改', backTo: 'start', opinionRequired: true },
          ],
          // 条件路由演示：时长 > 4 小时 → 需校级备案
          routing: {
            kind: 'conditional',
            branches: [{ when: { gt: [{ var: 'form.Integer_4' }, 4] }, to: 'UserTask_3' }],
            fallback: 'end',
          },
        },
        {
          id: 'UserTask_3', kind: 'userTask', name: '校级备案审批',
          assignee: { kind: 'role', value: 'school', dealMode: 'or' },
          auths: { [F]: readonly },
          actions: [
            { code: 'approve', name: '同意备案', opinionRequired: true },
            { code: 'reject', name: '不予备案', backTo: 'end', opinionRequired: true },
          ],
          routing: { kind: 'sequential', next: 'end' },
        },
        { id: 'end', kind: 'end', name: '结束', auths: {} },
      ],
    },
  });

  engine.forms.update((f) => f.id === form.id, { status: 'published' });
  engine.flows.update((f) => f.id === flow.id, { status: 'published' });
  engine.apps.update((a) => a.id === app.id, { formVersionId: form.id, flowVersionId: flow.id });

  console.log('[seed] 已写入演示数据：5 个用户 + 事项「会议室预约」（含表单 v1 / 流程 v1）');
  return true;
}
