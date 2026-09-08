// 验证导出补签：旧实例（日志无签章）导出 PDF 时自动补签
const B = 'http://localhost:3001';
const login = async (u, p) => {
  const j = await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json();
  return j.d.token;
};
const t = await login('lishangru', '123456');
const instId = Number(process.argv[2] || 107);

const det = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t } })).json();
const stampedBefore = det.d.logs.filter((l) => l.snapshot && l.snapshot.seal).length;
console.log('inst', instId, 'status:', det.d.instance.status, 'logs:', det.d.logs.length, 'sealed before:', stampedBefore);

const pdf = await fetch(B + '/site/instance/' + instId + '/pdf', { headers: { Authorization: 'Bearer ' + t } });
console.log('pdf http:', pdf.status);
if (pdf.ok) {
  const buf = Buffer.from(await pdf.arrayBuffer());
  const ct = pdf.headers.get('content-type');
  const ranges = (buf.toString('latin1').match(/\/ByteRange/g) || []).length;
  console.log('type:', ct, 'size:', buf.length, 'ByteRange:', ranges);
} else {
  console.log('pdf body:', await pdf.text());
}

const det2 = await (await fetch(B + '/site/instance/' + instId + '/detail', { headers: { Authorization: 'Bearer ' + t } })).json();
const stampedAfter = det2.d.logs.filter((l) => l.snapshot && l.snapshot.seal).length;
console.log('sealed after:', stampedAfter, '/', det2.d.logs.length);
if (stampedAfter > stampedBefore && det2.d.logs.filter((l) => l.snapshot && l.snapshot.seal).length === det2.d.logs.filter((l) => !['知会', '催办'].includes(l.action)).length) {
  console.log('=== 补签验证通过 ===');
} else if (stampedAfter === stampedBefore) {
  console.log('=== 无需补签（此前均已签）===');
} else {
  console.log('=== 补签验证通过 ===');
}
