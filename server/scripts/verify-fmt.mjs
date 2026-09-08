import { fmtValue } from '../src/services/pdf.js';

const v = [{ name: '我的知会.csv', url: '/uploads/mts3lkzed3edc619f825.csv', size: 282 }];
const r = fmtValue(v);
console.log(JSON.stringify(r));
if (!r.files.length || !r.files[0].hash) { console.log('=== FAIL ==='); process.exit(1); }
const t = r.files.map((f) => `${f.name}\n下载地址：${f.url}\nSHA-256：${f.hash}`).join('\n');
console.log('---PDF 渲染文本---');
console.log(t);
console.log('=== fmtValue 验证通过 ===');
