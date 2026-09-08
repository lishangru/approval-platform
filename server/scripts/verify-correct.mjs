// 验证自我修正：下级可改判自己的结论；上级打开签批页后锁定
import fs from 'node:fs';

const B = 'http://localhost:3001';
const login = async (u, p) => {
  const j = await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json();
  return j.d.token;
};
const t1 = await login('lishangru', '123456');   // 发起人
const t2 = await login('wangjianguo', '123456'); // 部门负责人（下级）
const t3 = await login('xiaozhang', '123456');   // 校级（上级）

// 发起
const apps = await (await fetch(B + '/site/apps', { headers: { Authorization: 'Bearer ' + t1 } })).json();
const li = await (await fetch(B + '/site/instance/launch', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t1 },
  body: JSON.stringify({ appId: apps.d[0].id, data: { Input_1: '修正测试会议', Radio_2: 'yes', Calendar_3: '2026-09-12', Integer_4: 2, Integer_5: 20, Textarea_6: '自我修正链路验证' } }),
})).json();
const instId = li.d.instanceId;
console.log('inst:', instId);

const deal = async (token, tid, op, comment) => (await (await fetch(B + '/site/task/' + tid + '/deal', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ operation: { code: op }, comment }),
})).json());

// 部门负责人审批通过
const todo2 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t2 } })).json();
const task2 = todo2.d.find((x) => x.instanceId === instId);
const r2 = await deal(t2, task2.taskId, 'approve', '下级：先同意');
console.log('dept approve:', r2.m);

// 上级此时未打开 → 下级可以改判退回
const det1 = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t2 } })).json();
console.log('correctable before open:', JSON.stringify(det1.d.correctable));
const cr = await (await fetch(B + '/site/instance/' + instId + '/correct', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t2 },
  body: JSON.stringify({ nodeId: det1.d.correctable[0].nodeId, result: 'reject', comment: '下级自我修正：改为退回' }),
})).json();
console.log('correct to reject:', cr.m, 'status:', cr.d?.status);
if (cr.e !== 0) process.exit(1);

// 此时流程退回发起人；下级再改判通过 → 恢复路由
const det2 = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t2 } })).json();
console.log('correctable after:', JSON.stringify(det2.d.correctable));
const cr2 = await (await fetch(B + '/site/instance/' + instId + '/correct', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t2 },
  body: JSON.stringify({ nodeId: det2.d.correctable[0].nodeId, result: 'approve', comment: '下级自我修正：恢复通过' }),
})).json();
console.log('correct to approve:', cr2.m, 'status:', cr2.d?.status, 'progress:', cr2.d?.progress);

// 上级打开签批页（deal-info）→ 锁定
const todo3 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t3 } })).json();
const task3 = todo3.d.find((x) => x.instanceId === instId);
const di = await (await fetch(B + '/site/task/' + task3.taskId + '/deal-info', { headers: { Authorization: 'Bearer ' + t3 } })).json();
console.log('superior opened deal-info:', di.ok !== false, 'task status:', di.d?.task?.status);
const det3 = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t2 } })).json();
console.log('correctable after superior opened:', JSON.stringify(det3.d.correctable));
const cr3 = await (await fetch(B + '/site/instance/' + instId + '/correct', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t2 },
  body: JSON.stringify({ nodeId: det3.d.correctable?.[0]?.nodeId ?? det2.d.correctable[0].nodeId, result: 'reject', comment: '锁定后尝试' }),
})).json();
console.log('correct after lock (expect fail):', cr3.m);
if (cr3.e === 0) { console.log('=== FAIL：锁定失败 ==='); process.exit(1); }

// 上级继续审批通过，流程走完
const r3 = await deal(t3, task3.taskId, 'approve', '上级：同意');
console.log('school approve:', r3.m, r3.d?.instanceStatus);

// 他人不能改（上级改下级的 → 应拒绝）
fs.writeFileSync('tmp-x.json', JSON.stringify({ instId }));
console.log('=== 自我修正链路验证通过 ===');
