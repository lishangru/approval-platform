// 验证 PDF 导出：发起→审批通过→导出→检查 ByteRange（多重签名）
import fs from 'node:fs';

const B = 'http://localhost:3001';
const login = async (u, p) => {
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json();
  return j.d?.token;
};
const t1 = await login('lishangru', '123456');
const t2 = await login('wangjianguo', '123456');
const t3 = await login('xiaozhang', '123456');

const apps = await (await fetch(B + '/site/apps', { headers: { Authorization: 'Bearer ' + t1 } })).json();
const app = apps.d[0];
const li = await (await fetch(B + '/site/instance/launch', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t1 },
  body: JSON.stringify({
    appId: app.id,
    data: { Input_1: 'PDF验证测试会议', Radio_2: 'yes', Calendar_3: '2026-09-10', Integer_4: 2, Integer_5: 20, Textarea_6: '验证 PDF 多重签名链' },
  }),
})).json();
if (li.e) { console.log('launch fail', JSON.stringify(li).slice(0, 200)); process.exit(1); }
const instId = li.d.instanceId;
console.log('instId:', instId);

const deal = async (token, tid, op, comment) => {
  const r = await fetch(B + '/site/task/' + tid + '/deal', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ operation: { code: op }, comment }),
  });
  return r.json();
};

const todo1 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t1 } })).json();
const start = todo1.d.find((x) => x.instanceId === instId);
if (start) {
  const r1 = await deal(t1, start.taskId, 'approve', '发起提交');
  console.log('start deal:', JSON.stringify(r1));
} else console.log('start node auto-dealt (no todo)');

const todo2 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t2 } })).json();
const t2task = todo2.d.find((x) => x.instanceId === instId);
if (t2task) {
  const r = await deal(t2, t2task.taskId, 'approve', '同意，请校级备案');
  console.log('dept deal:', JSON.stringify(r));
} else console.log('no dept task (maybe conditional)');

const todo3 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t3 } })).json();
const t3task = todo3.d.find((x) => x.instanceId === instId);
if (t3task) {
  const r = await deal(t3, t3task.taskId, 'approve', '备案通过');
  console.log('school deal:', JSON.stringify(r));
} else console.log('no school task (maybe ended at dept)');

const detail = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t1 } })).json();
console.log('status:', detail.d?.instance?.status, 'edges taken:', JSON.stringify(detail.d?.flow?.edges?.map((e) => e.taken)));

const pdfRes = await fetch(B + '/site/instance/' + instId + '/pdf', { headers: { Authorization: 'Bearer ' + t1 } });
if (!pdfRes.ok) { console.log('pdf fail', pdfRes.status, await pdfRes.text()); process.exit(1); }
const buf = Buffer.from(await pdfRes.arrayBuffer());
fs.writeFileSync('verify.pdf', buf);
const ranges = (buf.toString('latin1').match(/\/ByteRange/g) || []).length;
console.log('PDF size:', buf.length, 'ByteRange count:', ranges);
if (ranges < 2) { console.log('FAIL: expected >=2 signatures'); process.exit(1); }
console.log('=== PDF multi-signature OK ===');
