import crypto from 'node:crypto';
import { cstNow } from '../core/time.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

// ===== 个人签章（每个审批人独立证书）=====
// 证书在首次审批时自动生成并持久化（data/seals/{uid}.p12 + meta）。
// 说明：私钥由服务端托管，签名代表"平台记录的该用户审批行为"；
// 如需私钥仅本人持有（可靠电子签名），接入外部 CA + 端内签名替换本模块即可。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEALS_DIR = path.join(__dirname, '../../data/seals');

export interface SealInfo {
  subject: string;
  serial: string;
  fingerprint: string;
  passphrase: string;
  createdAt: string;
}

export interface SealResult {
  signature: string;       // PKCS#7 DER hex
  hash: string;            // 被签内容的 SHA-256
  subject: string;
  serial: string;
  fingerprint: string;
  signedAt: string;
}

export function sealPaths(uid: number) {
  return { p12: path.join(SEALS_DIR, uid + '.p12'), meta: path.join(SEALS_DIR, uid + '.meta.json') };
}

export function ensureSeal(name: string, number: string, uid: number): { p12: Buffer; info: SealInfo } {
  fs.mkdirSync(SEALS_DIR, { recursive: true });
  const { p12, meta } = sealPaths(uid);
  if (fs.existsSync(p12) && fs.existsSync(meta)) {
    return { p12: fs.readFileSync(p12), info: JSON.parse(fs.readFileSync(meta, 'utf-8')) };
  }
  const passphrase = crypto.randomBytes(16).toString('hex');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  cert.setSubject([
    { name: 'commonName', value: `${name}（${number}）`, valueTagClass: forge.asn1.Type.UTF8 as any },
    { name: 'organizationName', value: 'Approval Platform' },
    { shortName: 'OU', value: 'Personal Seal' },
  ]);
  cert.setIssuer([
    { name: 'commonName', value: '网上办事大厅 签章中心', valueTagClass: forge.asn1.Type.UTF8 as any },
    { name: 'organizationName', value: 'Approval Platform CA' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase)).getBytes();
  fs.writeFileSync(p12, Buffer.from(der, 'binary'));
  const derCert = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const info: SealInfo = {
    subject: `CN=${name}（${number}）,O=Approval Platform,OU=Personal Seal`,
    serial: cert.serialNumber,
    fingerprint: crypto.createHash('sha256').update(Buffer.from(derCert, 'binary')).digest('hex'),
    passphrase,
    createdAt: cstNow(),
  };
  fs.writeFileSync(meta, JSON.stringify(info, null, 1));
  return { p12: fs.readFileSync(p12), info };
}

export function getSealInfo(uid: number): SealInfo | null {
  const { meta } = sealPaths(uid);
  if (!fs.existsSync(meta)) return null;
  return JSON.parse(fs.readFileSync(meta, 'utf-8'));
}

export function resetSeal(uid: number): boolean {
  const { p12, meta } = sealPaths(uid);
  let removed = false;
  for (const f of [p12, meta]) {
    if (fs.existsSync(f)) { fs.unlinkSync(f); removed = true; }
  }
  return removed;
}

// 用某用户的个人签章对内容签名（PKCS#7 / SHA-256）
export function signWithSeal(uid: number, content: string): SealResult | null {
  const info = getSealInfo(uid);
  if (!info) return null;
  const p12Buf = fs.readFileSync(sealPaths(uid).p12);
  const p12store = (forge.pkcs12 as any).pkcs12FromAsn1((forge.asn1.fromDer as any)(p12Buf.toString('binary')), info.passphrase);
  let cert: any = null;
  let key: any = null;
  for (const sc of p12store.safeContents) {
    for (const bag of sc.safeBags) {
      if (bag.cert && !cert) cert = bag.cert;
      if (bag.key && !key) key = bag.key;
    }
  }
  if (!cert || !key) return null;
  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
  p7.sign();
  const signature = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return {
    signature: Buffer.from(signature, 'binary').toString('hex'),
    hash,
    subject: info.subject,
    serial: info.serial,
    fingerprint: info.fingerprint,
    signedAt: cstNow(),
  };
}
