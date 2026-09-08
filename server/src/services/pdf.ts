import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { SUBFILTER_ADOBE_PKCS7_DETACHED } from '@signpdf/utils';
import { evaluate } from '../domain/flow/expr.js';
import { sealPaths, getSealInfo } from './seal.js';
import { verifiedSignature } from './signature.js';
import type { WorkflowEngine } from '../domain/flow/engine.js';
import type { Instance } from '../core/types.js';

const SIGN_PASS = process.env.PDF_SIGN_PASS || 'approval-seal-2026';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const FONT_CANDIDATES = ['C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/Deng.ttf', 'C:/Windows/Fonts/simfang.ttf', 'C:/Windows/Fonts/msyh.ttc'];

// ===== 签发证书（自建 CA，持久化到 data/signing.p12，重启不变）=====
export function ensureSigningP12(dataDir: string): Buffer {
  const file = path.join(dataDir, 'signing.p12');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: '网上办事大厅 系统签章' },
    { name: 'organizationName', value: 'Approval Platform' },
    { shortName: 'OU', value: 'Digital Seal' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], SIGN_PASS)).getBytes();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(p12, 'binary'));
  return fs.readFileSync(file);
}

function loadCjkFont(pdfDoc: PDFDocument): string {
  pdfDoc.registerFontkit(fontkit);
  for (const f of FONT_CANDIDATES) {
    if (!fs.existsSync(f)) continue;
    try {
      const bytes = fs.readFileSync(f);
      pdfDoc.embedFont(bytes, { subset: false });
      return f;
    } catch { /* try next */ }
  }
  throw new Error('未找到可用的中文字体（需要 simhei.ttf / Deng.ttf 等）');
}

// ===== 文本换行 =====
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of String(text ?? '')) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    if (font.widthOfTextAtSize(cur + ch, size) > maxWidth) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  lines.push(cur);
  return lines;
}

export function sha256File(file: string): string {
  if (!fs.existsSync(file)) return '（文件缺失）';
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const FILE_RE = /^[.\/]/; // 附件 url 形如 /uploads/xxx
const fileMeta = (f: any) => {
  const url = String(f.url ?? '');
  const file = path.join(UPLOAD_DIR, path.basename(url));
  return { name: String(f.name ?? path.basename(url)), url, hash: sha256File(file) };
};
export function fmtValue(v: any): { text: string; files: { name: string; url: string; hash: string }[] } {
  if (v === null || v === undefined || v === '') return { text: '（未填写）', files: [] };
  if (Array.isArray(v)) {
    // 文件组件的值为对象数组：逐个补 名称/地址/SHA-256
    if (v.length && typeof v[0] === 'object' && typeof v[0].url === 'string' && FILE_RE.test(v[0].url)) {
      return { text: '', files: v.map(fileMeta) };
    }
    return { text: v.map((x) => (typeof x === 'object' ? (x as any).name ?? JSON.stringify(x) : String(x))).join('、'), files: [] };
  }
  if (typeof v === 'object') {
    if (typeof v.url === 'string' && FILE_RE.test(v.url)) {
      return { text: '', files: [fileMeta(v)] };
    }
    return { text: JSON.stringify(v), files: [] };
  }
  return { text: String(v), files: [] };
}

const STATUS_NAME: Record<string, string> = { draft: '草稿', running: '进行中', suspended: '挂起', finished: '已通过', revoked: '已撤销', rejected: '已否决' };

// ===== 生成申请单 PDF（含数字签名）=====
export async function generateInstancePdf(engine: WorkflowEngine, inst: Instance, p12: Buffer): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontFile = FONT_CANDIDATES.find((f) => fs.existsSync(f));
  if (!fontFile) throw new Error('未找到可用的中文字体（需要 simhei.ttf / Deng.ttf 等）');
  const font = await pdfDoc.embedFont(fs.readFileSync(fontFile), { subset: true });
  const PAGE_W = 595, M = 40, CONTENT_W = PAGE_W - M * 2;
  let page = pdfDoc.addPage([PAGE_W, 842]);
  let y = 800;

  const newPageIfNeeded = (need: number) => {
    if (y - need < M + 20) { page = pdfDoc.addPage([PAGE_W, 842]); y = 800; }
  };
  const draw = (text: string, x: number, size = 9, maxW = CONTENT_W, color = rgb(0.13, 0.13, 0.13)) => {
    for (const line of wrapText(text, font, size, maxW)) {
      newPageIfNeeded(size + 4);
      page.drawText(line, { x, y: y - size, size, font, color });
      y -= size + 4;
    }
  };
  const cell = (text: string, w: number, size = 9): string[] => {
    return wrapText(text || '', font, size, w - 8);
  };

  // —— 标题（居中）——
  const title = `${inst.appSnapshot.name}申请单`;
  const titleSize = 20;
  page.drawText(title, { x: (PAGE_W - font.widthOfTextAtSize(title, titleSize)) / 2, y: y - titleSize, size: titleSize, font, color: rgb(0.1, 0.1, 0.1) });
  y -= titleSize + 18;

  // —— 基本信息 ——
  const creator = engine.findUser(inst.createdBy);
  const flow = engine.flowOf(inst);
  const meta: [string, string][] = [
    ['编号', '#' + inst.id],
    ['发起人', `${creator?.name ?? ''}（${creator?.department ?? ''}，学工号 ${creator?.number ?? ''}）`],
    ['提交时间', inst.createdAt],
    ['当前状态', STATUS_NAME[inst.status] ?? inst.status],
    ['当前节点', inst.currentNodes.map((n) => flow.nodes.find((x) => x.id === n.nodeId)?.name ?? n.nodeId).join('、') || '—'],
    ['完成时间', inst.finishedAt ?? '—'],
  ];
  const IMG_TOKEN = '\u0000IMG';
  // 表格式绘制（单元格支持嵌图：lines 中的 IMG_TOKEN 由 row.imgs 提供图片）
  const imgCache = new Map<string, any>();
  const drawTable = async (headers: string[], colWidths: number[], rows: { lines: string[][]; raw?: any; imgs?: Record<number, { buffer: Buffer; kind: 'png' | 'jpg' }> }[]) => {
    const lineH = (line: string) => (line === IMG_TOKEN ? 32 : 13);
    const rowH = (lines: string[][]) => Math.max(...lines.map((l) => l.reduce((s, line) => s + lineH(line), 0))) + 10;
    const headH = 20;
    newPageIfNeeded(headH + 30);
    // header
    let x = M;
    page.drawRectangle({ x: M, y: y - headH, width: CONTENT_W, height: headH, color: rgb(0.92, 0.94, 0.97) });
    headers.forEach((h, i) => {
      page.drawText(h, { x: x + 6, y: y - headH + 6, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
      x += colWidths[i];
    });
    y -= headH;
    for (const row of rows) {
      const h = rowH(row.lines);
      newPageIfNeeded(h + 8);
      if (y - h < M) { page = pdfDoc.addPage([PAGE_W, 842]); y = 800; }
      x = M;
      for (let i = 0; i < row.lines.length; i++) {
        const lines = row.lines[i];
        let ty = y - 13;
        for (const line of lines) {
          if (line === IMG_TOKEN && row.imgs?.[i]) {
            const { buffer, kind } = row.imgs[i];
            const cacheKey = kind + ':' + crypto.createHash('sha1').update(buffer).digest('hex');
            let img = imgCache.get(cacheKey);
            if (!img) {
              img = kind === 'png' ? await pdfDoc.embedPng(buffer) : await pdfDoc.embedJpg(buffer);
              imgCache.set(cacheKey, img);
            }
            const maxW = colWidths[i] - 12, maxH = 26;
            const scale = Math.min(maxW / img.width, maxH / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            page.drawImage(img, { x: x + 6, y: ty - dh + 13, width: dw, height: dh });
            ty -= 32;
          } else {
            page.drawText(line, { x: x + 6, y: ty, size: 9, font, color: rgb(0.13, 0.13, 0.13) });
            ty -= 13;
          }
        }
        x += colWidths[i];
      }
      // 边框
      page.drawRectangle({ x: M, y: y - h, width: CONTENT_W, height: h, borderColor: rgb(0.75, 0.78, 0.82), borderWidth: 0.8 });
      let bx = M;
      for (const w of colWidths.slice(0, -1)) { bx += w; page.drawLine({ start: { x: bx, y: y - h }, end: { x: bx, y }, color: rgb(0.75, 0.78, 0.82), thickness: 0.8 }); }
      page.drawLine({ start: { x: M, y }, end: { x: M + CONTENT_W, y }, color: rgb(0.75, 0.78, 0.82), thickness: 0.8 });
      y -= h;
    }
  };

  await drawTable(['项目', '内容'], [110, CONTENT_W - 110], meta.map(([k, v]) => ({ lines: [cell(k, 110), cell(v, CONTENT_W - 110)] })));
  y -= 16;

  // —— 表单内容（按条件显隐过滤：被联动隐藏的字段不出现在申请单上）——
  draw('一、表单内容', M, 11);
  y -= 6;
  const form = engine.formOf(inst);
  const visibleComponents = form.components.filter((c) => !c.visibleIf || Boolean(evaluate(c.visibleIf, { vars: inst.vars as any, form: inst.data })));
  const formRows = visibleComponents.map((c) => {
    const { text, files } = fmtValue(inst.data[c.key]);
    let t = text;
    if (files.length) {
      t = files.map((f) => `${f.name}\n下载地址：${f.url}\nSHA-256：${f.hash}`).join('\n');
    }
    return { lines: [cell(c.label, 130), cell(t, CONTENT_W - 130)] };
  });
  await drawTable(['字段', '填写内容'], [130, CONTENT_W - 130], formRows);
  y -= 16;

  // —— 审批意见（一级一行，时间 hh:mm:ss 换行显示）——
  draw('二、审批意见', M, 11);
  y -= 6;
  const opinionLogs = engine.logs
    .filter((l) => l.instanceId === inst.id && !['提交', '重新提交', '撤销', '催办', '知会'].includes(l.action))
    .sort((a, b) => a.id - b.id);
  const splitTime = (t: string) => {
    const [d, tm] = t.split(' ');
    return d + '\n' + (tm ?? '');
  };
  const opinionRows = opinionLogs.map((l) => {
    let text = l.comment || '（无意见）';
    if (l.attachments?.length) {
      text += '\n' + l.attachments.map((a: any) => {
        const file = path.join(UPLOAD_DIR, path.basename(String(a.url ?? '')));
        return `附件：${a.name}（下载地址：${a.url}，SHA-256：${sha256File(file)}）`;
      }).join('\n');
    }
    const seal = (l.snapshot as any)?.seal as any;
    if (seal?.fingerprint) text += `\n个人签章：${seal.subject}（证书指纹 ${String(seal.fingerprint).slice(0, 16)}…，已验签）`;
    // 处理人格：本人设置了签名图片（且完整性/证书绑定校验通过）时，格内显示签名图
    const sig = verifiedSignature(l.actorUid);
    const nameLines = cell(l.actorName, 70);
    const imgs: Record<number, { buffer: Buffer; kind: 'png' | 'jpg' }> | undefined = sig
      ? { 1: { buffer: sig.buffer, kind: sig.format } } : undefined;
    const handlerLines = sig ? [...nameLines, IMG_TOKEN] : nameLines;
    return { lines: [cell(l.nodeName, 90), handlerLines, cell(l.action, 70), cell(text, CONTENT_W - 90 - 70 - 70 - 80), cell(splitTime(l.createdAt), 80)], imgs };
  });
  await drawTable(['节点', '处理人', '操作', '意见/附件', '时间'], [90, 70, 70, CONTENT_W - 90 - 70 - 70 - 80, 80], opinionRows.length ? opinionRows : [{ lines: [cell('—', 90), cell('—', 70), cell('—', 70), cell('尚无审批记录', CONTENT_W - 310), cell('—', 80)] }]);
  y -= 20;

  // —— 数字签名说明 ——
  newPageIfNeeded(40);
  draw('三、文件数字签名', M, 11);
  y -= 4;
  const sealedLogs = opinionLogs.filter((l) => (l.snapshot as any)?.seal?.fingerprint);
  draw(
    `本 PDF 采用逐级数字签名链：每个处理人的个人签章（共 ${sealedLogs.length} 枚）依次对文件进行 PKCS#7 数字签名，最后由系统证书封口。` +
    '在 Adobe Acrobat 等阅读器中可查看全部签名，任一签名验证有效即表明其覆盖范围内的内容未被篡改，并可与审批人一一对应，防止抵赖。',
    M, 9
  );
  y -= 4;
  for (const l of sealedLogs) {
    const seal = (l.snapshot as any).seal;
    draw(`已签名：${seal.subject}（时间 ${seal.signedAt}，指纹 ${String(seal.fingerprint).slice(0, 16)}…）`, M + 10, 9);
  }
  y -= 2;
  const imgBoundLogs = opinionLogs.filter((l) => verifiedSignature(l.actorUid));
  if (imgBoundLogs.length) {
    draw(`签名图片认证：以下处理人在表中显示了个人签名图片，每张图片的 SHA-256 指纹已用其个人证书做 PKCS#7 签名绑定（记录于审批日志的数字签章中），图片被篡改将导致验签失败。`, M, 9);
    for (const l of imgBoundLogs) {
      const sig = verifiedSignature(l.actorUid)!;
      draw(`签名图片：${l.actorName}（SHA-256 ${sig.hash.slice(0, 16)}…，已验签）`, M + 10, 9);
    }
  }

  // —— 签名链：逐级叠加个人签章（先处理人的先签），系统签章最后封口 ——
  const signer = new SignPdf();
  const p12Cert = new P12Signer(p12, { passphrase: SIGN_PASS });
  let buffer: Buffer<ArrayBuffer> = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
  for (const l of sealedLogs) {
    const seal = (l.snapshot as any).seal as { subject: string; signedAt: string };
    const info = getSealInfo(l.actorUid);
    if (!info) continue;
    const userP12: Buffer<ArrayBuffer> = fs.readFileSync(sealPaths(l.actorUid).p12);
    // 签名属性（Reason/Name）用 ASCII：部分阅读器对签名字典里的非 ASCII 字符串显示为乱码
    // 审批人与意见的对应关系见正文"二、审批意见"与"三、文件数字签名"
    buffer = plainAddPlaceholder({
      pdfBuffer: buffer,
      reason: `Approval signature - log #${l.id}`,
      contactInfo: 'service@approval.platform',
      name: `PersonalSeal-UID${l.actorUid}`,
      location: 'Approval Platform',
      signatureLength: 8192,
      subFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
    }) as Buffer<ArrayBuffer>;
    buffer = (await signer.sign(buffer, new P12Signer(userP12, { passphrase: info.passphrase }))) as Buffer<ArrayBuffer>;
  }

  buffer = plainAddPlaceholder({
    pdfBuffer: buffer,
    reason: `Approval form export (instance #${inst.id})`,
    contactInfo: 'service@approval.platform',
    name: 'ApprovalPlatform-SystemSeal',
    location: 'Approval Platform',
    signatureLength: 8192,
    subFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
  }) as Buffer<ArrayBuffer>;
  return signer.sign(buffer, p12Cert);
}
