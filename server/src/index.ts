import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './core/store.js';
import { WorkflowEngine } from './domain/flow/engine.js';
import { buildRoutes, fail, ok } from './api/routes.js';
import { authRequired } from './services/auth.js';
import { seedIfEmpty } from './seed.js';
import { registerSubscribers } from './services/notify.js';

const PORT = Number(process.env.PORT ?? 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const store = new JsonStore();
const engine = new WorkflowEngine(store);
seedIfEmpty(engine, store);
registerSubscribers(engine);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ===== 附件上传/下载 =====
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, Date.now().toString(36) + crypto.randomBytes(6).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.post('/api/upload', authRequired(engine), upload.single('file'), (req, res) => {
  const f = req.file;
  if (!f) return fail(res, 40001, '未收到文件');
  ok(res, { name: Buffer.from(f.originalname, 'latin1').toString('utf8'), url: '/uploads/' + f.filename, size: f.size });
});

app.get('/uploads/:name', authRequired(engine), (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return fail(res, 40404, '文件不存在');
  res.sendFile(file);
});

app.get('/api/health', (_req, res) => res.json({ e: 0, m: 'ok', d: { time: new Date().toISOString() } }));
app.use(buildRoutes(engine));

// 统一错误兜底
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  fail(res, 50000, err?.message ?? '服务器内部错误');
});

app.listen(PORT, () => {
  console.log(`[approval-server] listening on http://localhost:${PORT}`);
  console.log('[accounts] admin/admin123 · lishangru/123456 · wangjianguo/123456 · zhangmin/123456 · xiaozhang/123456');
});
