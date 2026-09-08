// 端到端冒烟测试：发起 → 部门审批 → 学工处审核 → (条件)校级备案 → 完成
const BASE = 'http://localhost:3001';

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.e !== 0) throw new Error(`${method} ${path} -> e=${json.e} m=${json.m} d=${JSON.stringify(json.d ?? '')}`);
  return json.d;
}
const login = (u, p) => api('POST', '/api/auth/login', null, { username: u, password: p });

function assert(cond, msg) { if (!cond) throw new Error('断言失败: ' + msg); console.log('  ✔', msg); }

async function main() {
  // 1. 登录
  const stu = await login('lishangru', '123456');
  assert(stu.principal.name === '李尚儒', '学生登录: ' + stu.principal.name);
  const admin = await login('admin', 'admin123');

  // 2. 自建独立事项（不依赖演示数据被修改）
  const app = await api('POST', '/system/app', admin.token, { name: '冒烟测试-会议室预约', desc: 'smoke专用' });
  const form = await api('POST', '/system/form', admin.token, {
    appId: app.id,
    components: [
      { type: 'input', key: 'Input_1', label: '会议主题', props: { maxLength: 50, required: true } },
      { type: 'radio', key: 'Radio_2', label: '是否需要投影设备', props: { options: [{ name: '需要', value: 'yes' }, { name: '不需要', value: 'no' }], required: true } },
      { type: 'calendar', key: 'Calendar_3', label: '使用日期', props: { required: true } },
      { type: 'integer', key: 'Integer_4', label: '使用时长（小时）', props: { min: 1, max: 12, required: true } },
      { type: 'integer', key: 'Integer_5', label: '参会人数', props: { min: 1, required: true } },
      { type: 'textarea', key: 'Textarea_6', label: '事由说明', props: { required: true } },
      { type: 'multiInput', key: 'MultiInput_7', label: '设备需求清单', props: { maxCount: 5 }, visibleIf: { '==': [{ var: 'form.Radio_2' }, 'yes'] } },
    ],
  });
  await api('POST', `/system/form/${form.id}/publish`, admin.token);
  const A = String(form.id);
  const flow = await api('POST', '/system/flow', admin.token, {
    appId: app.id,
    nodes: [
      { id: 'start', kind: 'start', name: '发起', auths: {}, draftAuths: { [A]: { Input_1: 'require', Radio_2: 'require', Calendar_3: 'require', Integer_4: 'require', Integer_5: 'require', Textarea_6: 'require', MultiInput_7: 'writable' } }, routing: { kind: 'sequential', next: 'UserTask_1' } },
      { id: 'UserTask_1', kind: 'userTask', name: '部门负责人审批', assignee: { kind: 'dept_leader', dealMode: 'or' }, auths: { [A]: {} }, allowForce: true, actions: [{ code: 'approve', name: '同意' }, { code: 'reject', name: '退回修改', backTo: 'start', opinionRequired: true }, { code: 'delegate', name: '转办' }, { code: 'addSign', name: '加签' }], routing: { kind: 'sequential', next: 'UserTask_2' } },
      { id: 'UserTask_2', kind: 'userTask', name: '学工处审核', assignee: { kind: 'role', value: 'office', dealMode: 'or' }, auths: { [A]: { Integer_4: 'writable' } }, allowForce: true, actions: [{ code: 'approve', name: '审核通过', opinionRequired: true }, { code: 'reject', name: '退回修改', backTo: 'start', opinionRequired: true }], routing: { kind: 'conditional', branches: [{ when: { gt: [{ var: 'form.Integer_4' }, 4] }, to: 'UserTask_3' }], fallback: 'end' } },
      { id: 'UserTask_3', kind: 'userTask', name: '校级备案审批', assignee: { kind: 'role', value: 'school', dealMode: 'or' }, auths: { [A]: {} }, actions: [{ code: 'approve', name: '同意备案', opinionRequired: true }, { code: 'reject', name: '不予备案', backTo: 'end', opinionRequired: true }], routing: { kind: 'sequential', next: 'end' } },
      { id: 'end', kind: 'end', name: '结束', auths: {} },
    ],
    variables: [],
  });
  await api('POST', `/system/flow/${flow.id}/publish`, admin.token);
  assert(true, `自建事项 #${app.id}（表单#${form.id}/流程#${flow.id}）已发布`);

  // 3. 事项大厅 + start-info
  const info = await api('GET', `/site/app/${app.id}/start-info`, stu.token);
  assert(info.form.components.length === 7, 'start-info 表单组件 7 个');
  assert(info.form.components.find((c) => c.key === 'Input_1').auth === 'require', 'Input_1 在起点为必填');

  // 3. 校验失败（缺必填）
  const bad = await fetch(BASE + '/site/instance/launch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + stu.token },
    body: JSON.stringify({ appId: app.id, data: { Input_1: '前端技术例会' } }),
  }).then((r) => r.json());
  assert(bad.e === 10049 && bad.d.length === 5, '缺必填字段返回字段级错误 e=10049: ' + bad.d.map((x) => x.key).join(','));

  // 4. 正常发起（时长 6 小时 → 触发校级备案分支）
  const inst = await api('POST', '/site/instance/launch', stu.token, {
    appId: app.id,
    data: { Input_1: '前端技术例会', Radio_2: 'yes', Calendar_3: '2026-09-10', Integer_4: 6, Integer_5: 12, Textarea_6: '每周技术例会', MultiInput_7: ['投影仪', 'HDMI线'] },
  });
  assert(inst.status === 'running', `发起成功 inst=${inst.instanceId}`);

  // 5. 部门负责人（王建国）待办 & 签批
  const leader = await login('wangjianguo', '123456');
  const todo1 = await api('GET', '/site/task/list?box=todo', leader.token);
  assert(todo1.some((t) => t.instanceId === inst.instanceId && t.nodeName === '部门负责人审批'), '负责人收到待办');
  const task1 = todo1.find((t) => t.instanceId === inst.instanceId);
  const di1 = await api('GET', `/site/task/${task1.taskId}/deal-info`, leader.token);
  assert(di1.node.actions.some((a) => a.code === 'delegate') && di1.node.actions.some((a) => a.code === 'addSign'), '节点开放 同意/退回/转办/加签');
  await api('POST', `/site/task/${task1.taskId}/deal`, leader.token, {
    operation: { code: 'reject' }, comment: '', // 退回需要意见 → 应被拒绝
  }).catch(() => { console.log('  ✔ 空意见退回被拦截'); });
  await api('POST', `/site/task/${task1.taskId}/deal`, leader.token, { operation: { code: 'approve', }, comment: '同意，注意设备' });

  // 6. 学工处审核（张敏，可修改时长字段 writable）
  const office = await login('zhangmin', '123456');
  const todo2 = await api('GET', '/site/task/list?box=todo', office.token);
  const task2 = todo2.find((t) => t.instanceId === inst.instanceId);
  assert(task2?.nodeName === '学工处审核', '学工处收到待办');
  await api('POST', `/site/task/${task2.taskId}/deal`, office.token, {
    operation: { code: 'approve' }, comment: '时长调整为5小时，按流程报备', data: { Integer_4: 5 },
  });

  // 7. 条件路由：5 > 4 → 校级备案（张校长）
  const school = await login('xiaozhang', '123456');
  const todo3 = await api('GET', '/site/task/list?box=todo', school.token);
  const task3 = todo3.find((t) => t.instanceId === inst.instanceId);
  assert(task3?.nodeName === '校级备案审批', '条件路由命中：>4小时进入校级备案');
  await api('POST', `/site/task/${task3.taskId}/deal`, school.token, { operation: { code: 'approve' }, comment: '备案通过' });

  // 8. 终态校验
  const detail = await api('GET', `/site/instance/${inst.instanceId}/detail`, stu.token);
  assert(detail.instance.status === 'finished', '流程走完 status=finished');
  assert(detail.form.data.Integer_4 === 5, '审批人修改时长已生效: ' + detail.form.data.Integer_4);
  assert(detail.logs.length >= 4, '审批日志 ' + detail.logs.length + ' 条');
  assert(detail.flow.nodes.find((n) => n.id === 'UserTask_3').state === 'done', '流程图节点状态');
  console.log('  ✔ 全链路: 发起→部门审批→学工处(改时长)→条件路由→校级备案→完成');

  // 9. 退回重报路径
  const inst2 = await api('POST', '/site/instance/launch', stu.token, {
    appId: app.id,
    data: { Input_1: '研讨会', Radio_2: 'no', Calendar_3: '2026-09-11', Integer_4: 2, Integer_5: 8, Textarea_6: '学术研讨' },
  });
  const todo1b = await api('GET', '/site/task/list?box=todo', leader.token);
  const t1b = todo1b.find((t) => t.instanceId === inst2.instanceId);
  await api('POST', `/site/task/${t1b.taskId}/deal`, leader.token, { operation: { code: 'reject' }, comment: '时间冲突，请改期' });
  let mine = await api('GET', '/site/instance/mine', stu.token);
  const rec2 = mine.find((x) => x.id === inst2.instanceId);
  assert(rec2.status === 'running' && rec2.currentNodeNames.includes('发起'), '被退回到发起人');
  await api('POST', `/site/instance/${inst2.instanceId}/resubmit`, stu.token, { data: { Calendar_3: '2026-09-15' } });
  const todo1c = await api('GET', '/site/task/list?box=todo', leader.token);
  assert(todo1c.some((t) => t.instanceId === inst2.instanceId), '重报后再次进入负责人待办');
  console.log('  ✔ 退回→修改→重新提交 链路 OK');

  // 10. 消息 & 已办 & 撤销
  const msgs = await api('GET', '/site/message/list', stu.token);
  assert(msgs.length >= 1, '消息中心 ' + msgs.length + ' 条');
  const fin = await api('GET', '/site/task/list?box=finished', leader.token);
  assert(fin.length >= 1, '已办列表 ' + fin.length + ' 条');
  const inst3 = await api('POST', '/site/instance/launch', stu.token, {
    appId: app.id,
    data: { Input_1: '临时会议', Radio_2: 'no', Calendar_3: '2026-09-12', Integer_4: 1, Integer_5: 3, Textarea_6: '快速碰头' },
  });
  await api('POST', `/site/instance/${inst3.instanceId}/revoke`, stu.token);
  mine = await api('GET', '/site/instance/mine', stu.token);
  assert(mine.find((x) => x.id === inst3.instanceId).status === 'revoked', '发起人撤销成功');
  console.log('  ✔ 消息/已办/撤销 OK');

  console.log('\n=== 冒烟测试全部通过 ===');
}

main().catch((e) => { console.error('\n✘ 测试失败:', e.message); process.exit(1); });
