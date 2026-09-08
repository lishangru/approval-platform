// 强制审批测试：管理员对 allowForce 节点强行通过/退回（自建独立事项，不依赖演示数据）
const BASE = 'http://localhost:3001';
async function api(m, p, t, b) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json();
  if (j.e !== 0) throw new Error(`${m} ${p} -> ${j.m}`);
  return j.d;
}
const login = (u, p) => api('POST', '/api/auth/login', null, { username: u, password: p });

(async () => {
  const stu = await login('lishangru', '123456');
  const admin = await login('admin', 'admin123');

  // 自建事项：两个节点均 allowForce
  const app = await api('POST', '/system/app', admin.token, { name: '强制审批测试事项', desc: 'force-test 专用' });
  const form = await api('POST', '/system/form', admin.token, {
    appId: app.id,
    components: [{ type: 'input', key: 'Input_1', label: '事由', props: { required: true } }],
  });
  await api('POST', `/system/form/${form.id}/publish`, admin.token);
  const A = String(form.id);
  const flow = await api('POST', '/system/flow', admin.token, {
    appId: app.id,
    nodes: [
      { id: 'start', kind: 'start', name: '发起', auths: {}, draftAuths: { [A]: { Input_1: 'require' } }, routing: { kind: 'sequential', next: 'UserTask_1' } },
      { id: 'UserTask_1', kind: 'userTask', name: '部门负责人审批', assignee: { kind: 'dept_leader', dealMode: 'or' }, auths: { [A]: {} }, allowForce: true, actions: [{ code: 'approve', name: '同意' }, { code: 'reject', name: '退回修改', backTo: 'start', opinionRequired: true }], routing: { kind: 'sequential', next: 'UserTask_2' } },
      { id: 'UserTask_2', kind: 'userTask', name: '学工处审核', assignee: { kind: 'role', value: 'office', dealMode: 'or' }, auths: { [A]: {} }, allowForce: true, actions: [{ code: 'approve', name: '通过' }], routing: { kind: 'sequential', next: 'end' } },
      { id: 'end', kind: 'end', name: '结束', auths: {} },
    ],
    variables: [],
  });
  await api('POST', `/system/flow/${flow.id}/publish`, admin.token);

  // 发起一单
  const inst = await api('POST', '/site/instance/launch', stu.token, {
    appId: app.id,
    data: { Input_1: '强制审批演示' },
  });

  // 详情：当前节点应允许强制审批
  let det = await api('GET', `/site/instance/${inst.instanceId}/detail`, admin.token);
  const cur = det.flow.nodes.find((n) => n.state === 'current');
  console.log('当前节点:', cur.name, 'allowForce:', cur.allowForce, '待处理:', cur.candidates.join(','));
  if (!det.currentAllowForce) throw new Error('应允许强制审批');

  // 管理员强制通过 → 进入下一节点
  await api('POST', `/site/instance/${inst.instanceId}/force`, admin.token, { action: 'approve', comment: '管理员代批：情况紧急' });
  det = await api('GET', `/site/instance/${inst.instanceId}/detail`, admin.token);
  const cur2 = det.flow.nodes.find((n) => n.state === 'current');
  if (!cur2 || cur2.id !== 'UserTask_2') throw new Error('强制通过后应到达学工处审核，实际: ' + (cur2?.id ?? det.instance.status));
  console.log('✔ 强制通过后到达:', cur2.name);

  // 管理员强制退回 → 终结
  await api('POST', `/site/instance/${inst.instanceId}/force`, admin.token, { action: 'reject', comment: '材料不全，作废' });
  det = await api('GET', `/site/instance/${inst.instanceId}/detail`, admin.token);
  if (det.instance.status !== 'rejected') throw new Error('强制退回后应为 rejected，实际: ' + det.instance.status);
  const flog = det.logs.find((l) => l.action.includes('强制退回'));
  if (!flog) throw new Error('缺少强制退回日志');
  console.log('✔ 强制退回后 status=rejected，日志:', flog.action, '备注:', flog.comment);

  const det2 = await api('GET', `/site/instance/${inst.instanceId}/detail`, stu.token);
  if (det2.instance.status !== 'rejected') throw new Error('学生侧状态不同步');
  console.log('=== 强制审批测试通过 ===');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
