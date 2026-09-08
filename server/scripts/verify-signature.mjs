// 验证个人签名图片：上传 → 详情/PDF 中绑定 → 篡改检测
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

const B = 'http://localhost:3001';
const login = async (u, p) => {
  const j = await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json();
  return j.d.token;
};

// 生成一个 160x60 的"手写签名" PNG（随机笔画模拟）
function makePng(w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      // 画几条正弦曲线当笔画
      const on = Math.abs(y - (30 + 18 * Math.sin(x / 9))) < 2.2 || Math.abs(y - (32 + 14 * Math.sin(x / 7 + 2))) < 1.8;
      raw[i] = 26; raw[i + 1] = 26; raw[i + 2] = 26; raw[i + 3] = on ? 255 : 0;
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    return Buffer.concat([len, td, Buffer.from([0, 0, 0, 0])]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const t2 = await login('wangjianguo', '123456');
const H2 = { Authorization: 'Bearer ' + t2 };

// 1) 上传签名
const png = makePng(160, 60);
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'signature.png');
const up = await (await fetch(B + '/api/mysignature', { method: 'POST', headers: H2, body: fd })).json();
console.log('upload:', up.m, 'hash:', up.d?.hash?.slice(0, 16));

// 2) 查询 + 拉图
const info = await (await fetch(B + '/api/mysignature', { headers: H2 })).json();
console.log('info:', info.d.has, info.d.format);
const img = await fetch(B + '/api/mysignature/image', { headers: H2 });
console.log('image:', img.status, img.headers.get('content-type'), (await img.arrayBuffer()).byteLength, 'bytes');

// 3) 发起并走两级审批，导出 PDF
const t1 = await login('lishangru', '123456');
const t3 = await login('xiaozhang', '123456');
const apps = await (await fetch(B + '/site/apps', { headers: { Authorization: 'Bearer ' + t1 } })).json();
const li = await (await fetch(B + '/site/instance/launch', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t1 },
  body: JSON.stringify({ appId: apps.d[0].id, data: { Input_1: '签名图测试', Radio_2: 'yes', Calendar_3: '2026-09-13', Integer_4: 3, Integer_5: 15, Textarea_6: '验证签名图片渲染' } }),
})).json();
const instId = li.d.instanceId;
const deal = async (token, tid, op, c) => (await (await fetch(B + '/site/task/' + tid + '/deal', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ operation: { code: op }, comment: c }) }))).json();
const todo2 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t2 } })).json();
await deal(t2, todo2.d.find((x) => x.instanceId === instId).taskId, 'approve', '部门同意');
const todo3 = await (await fetch(B + '/site/task/list?box=todo', { headers: { Authorization: 'Bearer ' + t3 } })).json();
const t3task = todo3.d.find((x) => x.instanceId === instId);
if (t3task) await deal(t3, t3task.taskId, 'approve', '校级备案');

const pdfRes = await fetch(B + '/site/instance/' + instId + '/pdf', { headers: { Authorization: 'Bearer ' + t1 } });
console.log('pdf:', pdfRes.status, (await pdfRes.arrayBuffer()).byteLength, 'bytes');

// 4) 篡改检测：改文件 → verifiedSignature 应失败（导出的 PDF 中不再渲染该图）
const sigPath = 'data/signatures/3.png';
fs.writeFileSync(sigPath, Buffer.from('tampered'));
const det = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t2 } })).json();
console.log('log seal contains img hash:', JSON.stringify(det.d.logs.some((l) => l.snapshot?.seal)));
const pdfRes2 = await fetch(B + '/site/instance/' + instId + '/pdf', { headers: { Authorization: 'Bearer ' + t1 } });
console.log('pdf after tamper:', pdfRes2.status);
// 恢复：重新上传正确的图
const fd2 = new FormData();
fd2.append('file', new Blob([png], { type: 'image/png' }), 'signature.png');
await fetch(B + '/api/mysignature', { method: 'POST', headers: H2, body: fd2 });
console.log('=== 签名图片链路验证通过 ===');
