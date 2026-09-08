// 验证 PDF 内嵌 RFC3161 时间戳
const B = 'http://localhost:3001';
const j = await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json();
const r = await fetch(B + '/site/instance/133/pdf', { headers: { Authorization: 'Bearer ' + j.d.token } });
const buf = Buffer.from(await r.arrayBuffer());
const s = buf.toString('latin1');
console.log('pdf:', r.status, buf.length, 'bytes');
console.log('ByteRange:', (s.match(/\/ByteRange/g) || []).length, '| DocTimeStamp:', s.includes('/DocTimeStamp'), '| RFC3161:', s.includes('RFC3161'), '| DSS(LTV):', s.includes('/DSS'));
console.log((s.match(/\/Type ?\/DocTimeStamp/g) || []).length ? '=== 时间戳签名 OK ===' : '=== FAIL ===');
