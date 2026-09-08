import express from 'express';
import cors from 'cors';
import { JsonStore } from './core/store.js';
import { WorkflowEngine } from './domain/flow/engine.js';
import { buildRoutes, fail } from './api/routes.js';
import { seedIfEmpty } from './seed.js';
import { registerSubscribers } from './services/notify.js';

const PORT = Number(process.env.PORT ?? 3001);

const store = new JsonStore();
const engine = new WorkflowEngine(store);
seedIfEmpty(engine, store);
registerSubscribers(engine);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

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
