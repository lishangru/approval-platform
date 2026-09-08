import crypto from 'node:crypto';
import { cstNow } from '../core/time.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSeal, signWithSeal, sealPaths } from './seal.js';

// ===== 个人签名图片（每个账号一份：上传图片或手写板生成）=====
// 图片经 SHA-256 计算后用本人个人证书做 PKCS#7 签名绑定（防篡改、可离线验证）；
// 导出 PDF 时校验完整性后才渲染到"处理人"格内。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIG_DIR = path.join(__dirname, '../../data/signatures');

export interface SignatureMeta {
  hash: string;          // 图片文件 SHA-256
  format: 'png' | 'jpg';
  updatedAt: string;
  sealSig: string;       // 个人证书对 "signature-image:{uid}:{hash}" 的 PKCS#7 签名（hex）
  sealFingerprint: string;
}

export function sigPaths(uid: number) {
  return { meta: path.join(SIG_DIR, uid + '.meta.json') };
}

function imgPath(uid: number, format: string) {
  return path.join(SIG_DIR, uid + '.' + format);
}

export function getSignatureInfo(uid: number): SignatureMeta | null {
  const { meta } = sigPaths(uid);
  if (!fs.existsSync(meta)) return null;
  return JSON.parse(fs.readFileSync(meta, 'utf-8'));
}

// 导出 PDF 用：读取并校验签名图（文件未被篡改且证书绑定存在）
export function verifiedSignature(uid: number): { buffer: Buffer; format: 'png' | 'jpg'; hash: string; sealSig: string } | null {
  const meta = getSignatureInfo(uid);
  if (!meta) return null;
  const file = imgPath(uid, meta.format);
  if (!fs.existsSync(file)) return null;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== meta.hash || !meta.sealSig) return null;
  return { buffer: fs.readFileSync(file), format: meta.format, hash: actual, sealSig: meta.sealSig };
}

// 审批盖章内容绑定用：签名图是否存在且完整
export function signatureBinding(uid: number): { hash: string } | null {
  return verifiedSignature(uid) ? { hash: verifiedSignature(uid)!.hash } : null;
}

export function setSignature(uid: number, buf: Buffer, format: 'png' | 'jpg', user: { name: string; number: string }): SignatureMeta {
  fs.mkdirSync(SIG_DIR, { recursive: true });
  // 清掉另一格式的旧图
  for (const f of ['png', 'jpg']) {
    const p = imgPath(uid, f);
    if (f !== format && fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.writeFileSync(imgPath(uid, format), buf);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  // 用本人个人证书对图片指纹做 PKCS#7 签名绑定
  if (!fs.existsSync(sealPaths(uid).meta)) ensureSeal(user.name, user.number, uid);
  const bound = signWithSeal(uid, `signature-image:${uid}:${hash}`);
  const info: SignatureMeta = {
    hash,
    format,
    updatedAt: cstNow(),
    sealSig: bound?.signature ?? '',
    sealFingerprint: bound?.fingerprint ?? '',
  };
  fs.writeFileSync(sigPaths(uid).meta, JSON.stringify(info, null, 1));
  return info;
}

export function clearSignature(uid: number): boolean {
  const meta = getSignatureInfo(uid);
  let removed = false;
  if (meta) {
    const p = imgPath(uid, meta.format);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed = true; }
  }
  const { meta: m } = sigPaths(uid);
  if (fs.existsSync(m)) { fs.unlinkSync(m); removed = true; }
  return removed;
}

export function readSignatureImage(uid: number): { buffer: Buffer; format: 'png' | 'jpg' } | null {
  const meta = getSignatureInfo(uid);
  if (!meta) return null;
  const file = imgPath(uid, meta.format);
  if (!fs.existsSync(file)) return null;
  return { buffer: fs.readFileSync(file), format: meta.format };
}
