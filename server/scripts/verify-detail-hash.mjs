// 验证详情接口：表单文件值与日志附件均带 hash
const B = 'http://localhost:3001';
const j = await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json();
const t = j.d.token;
const H = { Authorization: 'Bearer ' + t };

const det = await (await fetch(B + '/site/instance/60/detail', { headers: H })).json();
const fileKey = Object.keys(det.d.form.data).find((k) => JSON.stringify(det.d.form.data[k]).includes('/uploads/'));
console.log('form file value:', JSON.stringify(det.d.form.data[fileKey]).slice(0, 260));
const logAtt = det.d.logs.filter((l) => l.attachments && l.attachments.length);
console.log('log attachments:', JSON.stringify(logAtt.map((l) => l.attachments)).slice(0, 260));
const okHash = (o) => o && o.hash && /^[0-9a-f]{64}$/.test(o.hash);
const allOk =
  (Array.isArray(det.d.form.data[fileKey]) ? det.d.form.data[fileKey] : [det.d.form.data[fileKey]]).every(okHash) &&
  logAtt.flatMap((l) => l.attachments).every(okHash);
console.log(allOk ? '=== 详情附件 hash 验证通过 ===' : '=== FAIL ===');
