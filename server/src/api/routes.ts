import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import type { WorkflowEngine } from '../domain/flow/engine.js';
import type { Principal, Json, FieldError } from '../core/types.js';
import { formEngine } from '../domain/form/engine.js';
import { evaluate } from '../domain/flow/expr.js';
import { assigneeRegistry, inScope } from '../domain/flow/assignees.js';
import { localAuth, authRequired, requireRole, requireTotp, hashPassword, makeSalt, signToken } from '../services/auth.js';
import { ensureSigningP12, generateInstancePdf, sha256File } from '../services/pdf.js';
import { getSealInfo, resetSeal } from '../services/seal.js';
import path from 'node:path';
import { oauthConfig, createState, checkState, buildAuthorizeUrl, exchangeCode, fetchUserinfo, matchLocalUser } from '../services/oauth.js';
import type { NextFunction } from 'express';

export const ok = (res: Response, d: unknown = null, m = '操作成功') => res.json({ e: 0, m, d });
export const fail = (res: Response, code: number, m: string, d: unknown = null) => res.status(code >= 1000 ? 200 : code).json({ e: code, m, d });

const P = (req: Request): Principal => (req as any).principal as Principal;
const num = (v: unknown): number => Number(v);

// 沿顺序链探测第一个"发起人指定"节点（发起页/签批页据此显示指定框）
function findChooseNode(nodes: import('../core/types.js').FlowNode[], fromNodeId: string): import('../core/types.js').FlowNode | null {
  let cur: import('../core/types.js').FlowNode | undefined = nodes.find((n) => n.id === fromNodeId);
  if (!cur) return null;
  for (let depth = 0; depth < 20 && cur; depth++) {
    const r = cur.routing;
    const targets: string[] = r?.kind === 'conditional'
      ? [...(r.branches ?? []).map((b) => b.to), r.fallback ?? 'end']
      : r?.kind === 'parallel' ? (r.to ?? []) : [r?.next ?? 'end'];
    const userTasks = targets
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is import('../core/types.js').FlowNode => Boolean(n) && n!.kind === 'userTask');
    if (userTasks.length === 1) {
      const ut = userTasks[0];
      if (ut.assignee?.kind === 'initiator_choose') return ut;
      cur = ut;
      continue;
    }
    return null;
  }
  return null;
}

// CSV 导出（Excel 兼容：UTF-8 BOM）
function csvRes(res: Response, filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(filename)}`);
  res.send('\uFEFF' + body);
}

export function buildRoutes(engine: WorkflowEngine): Router {
  const r = Router();
  const auth = authRequired(engine);
  const sys = [auth, requireRole('admin'), requireTotp(engine)];

  // =============== 公开 ===============
  r.post('/api/auth/login', (req, res) => {
    try {
      const result = localAuth.login(req.body ?? {}, engine);
      if (!result) return fail(res, 40001, '账号或密码错误');
      ok(res, result);
    } catch (e: any) {
      fail(res, 40301, e.message);
    }
  });

  // ===== 第三方 OAuth2 登录（预留接口：配置 OAUTH_* 环境变量后自动启用）=====
  r.get('/api/auth/oauth/:provider/authorize', (req, res) => {
    const cfg = oauthConfig();
    if (!cfg) return fail(res, 40002, '第三方登录未配置（需要 OAUTH_* 环境变量）');
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/oauth/${req.params.provider}/callback`;
    const state = createState();
    res.redirect(buildAuthorizeUrl(cfg, redirectUri, state));
  });

  r.get('/api/auth/oauth/:provider/callback', async (req, res) => {
    const cfg = oauthConfig();
    if (!cfg) return fail(res, 40002, '第三方登录未配置');
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || !checkState(state)) return fail(res, 40002, 'state 校验失败或缺少 code');
    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/oauth/${req.params.provider}/callback`;
      const accessToken = await exchangeCode(cfg, code, redirectUri);
      const userinfo = await fetchUserinfo(cfg, accessToken);
      const user = matchLocalUser(engine, cfg, userinfo);
      if (!user) return fail(res, 40002, `第三方账号未能匹配本平台用户（${cfg.userField} 字段）`);
      if (user.status === 'disabled') return fail(res, 40301, '账号已被禁用');
      const token = signToken({ uid: user.id });
      res.redirect(`${cfg.frontBase}/#/oauth-callback?token=${encodeURIComponent(token)}`);
    } catch (e: any) {
      fail(res, 50000, 'OAuth 登录失败: ' + e.message);
    }
  });

  // ===== 第三方平台开放接口（API Key 认证）=====
  const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
    const key = (req.headers['x-api-key'] as string) ?? (req.query.apikey as string) ?? String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const row = key ? engine.apikeys.find((k) => k.key === key && k.status === 'active') : undefined;
    if (!row) return res.status(401).json({ e: 40100, m: '无效或已吊销的 API Key', d: null });
    (req as any).apiKey = row;
    next();
  };

  // 查询指定用户指定事项的审批状态（供第三方平台集成）
  // GET /open/approval/status?username=<学工号或账号>&app=<appId 或事项名称>[&instanceId=]
  r.get('/open/approval/status', apiKeyAuth, (req, res) => {
    const username = String(req.query.username ?? '').trim();
    const instanceIdQ = req.query.instanceId ? num(req.query.instanceId) : null;
    const appIdQ = req.query.appId ? num(req.query.appId) : null;
    const appName = String(req.query.app ?? '').trim();

    const user = engine.users.find((u) => u.number === username || u.username === username);
    if (!user) return ok(res, { found: false, reason: 'user_not_found', message: '用户不存在' });

    // 定位事项与实例
    let inst: import('../core/types.js').Instance | undefined;
    let app = undefined as import('../domain/flow/engine.js').AppRow | undefined;
    if (instanceIdQ) {
      inst = engine.instances.find((i) => i.id === instanceIdQ && i.createdBy === user.id);
      app = inst ? engine.apps.find((a) => a.id === inst!.appId) : undefined;
      if (!inst) return ok(res, { found: false, reason: 'instance_not_found', message: '该用户名下没有此编号的申请' });
    } else {
      app = appIdQ ? engine.apps.find((a) => a.id === appIdQ) : engine.apps.find((a) => a.name === appName);
      if (!app) return ok(res, { found: false, reason: 'app_not_found', message: '事项不存在（请用 appId 或精确事项名称）' });
      const list = engine.instances.filter((i) => i.createdBy === user.id && i.appId === app!.id).sort((a, b) => b.id - a.id);
      inst = list[0];
    }

    const statusMap: Record<string, { status: string; approved: boolean }> = {
      finished: { status: 'approved', approved: true },
      rejected: { status: 'rejected', approved: false },
      revoked: { status: 'revoked', approved: false },
      running: { status: 'running', approved: false },
      suspended: { status: 'running', approved: false },
      draft: { status: 'draft', approved: false },
    };
    const st = inst ? (statusMap[inst.status] ?? { status: inst.status, approved: false }) : null;
    // 是否曾通过（该用户在此事项下存在已完成的申请）
    const everApproved = engine.instances.filter((i) => i.createdBy === user.id && i.appId === app!.id && i.status === 'finished').length > 0;
    ok(res, {
      found: Boolean(inst),
      reason: inst ? undefined : 'no_instance',
      message: inst ? undefined : '该用户尚未提交此事项的申请',
      user: { name: user.name, number: user.number, department: user.department },
      app: { id: app?.id, name: app?.name },
      everApproved,                       // 该用户在此事项下是否曾有已通过的申请
      instance: inst ? {
        id: inst.id,
        status: st!.status,            // approved / rejected / running / revoked / draft
        approved: st!.approved,        // 是否通过
        progress: inst.progress,
        finishedAt: inst.finishedAt ?? null,
        currentNodes: inst.currentNodes.map((n) => engine.flowOf(inst!).nodes.find((x) => x.id === n.nodeId)?.name ?? n.nodeId),
      } : null,
    });
  });

  // =============== 用户侧 /site ===============
  r.use('/site', auth);

  r.get('/site/me', (req, res) => ok(res, P(req)));

  // 选人数据源（所有登录用户可用：发起人指定/转办/加签/知会）
  r.get('/site/user/options', (_req, res) => {
    ok(res, engine.users.all().filter((u) => u.status !== 'disabled').map((u) => ({ id: u.id, name: u.name, number: u.number, department: u.department, group: u.group ?? '' })));
  });

  // 事项大厅（按可见范围过滤；管理员可见全部）
  r.get('/site/apps', (req, res) => {
    const p = P(req);
    const isAdmin = p.roles.includes('admin');
    const apps = engine.apps.all()
      .filter((a) => isAdmin || inScope({ id: p.uid, roles: p.roles, group: p.group, departmentId: p.departmentId }, a.visibility))
      .map((a) => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, published: Boolean(a.formVersionId && a.flowVersionId) }));
    ok(res, apps);
  });

  // 可见范围校验（start-info / launch 共用）
  const checkVisible = (req: Request, res: Response, app: { visibility?: any }): boolean => {
    const p = P(req);
    if (p.roles.includes('admin')) return true;
    if (!inScope({ id: p.uid, roles: p.roles, group: p.group, departmentId: p.departmentId }, app.visibility)) {
      fail(res, 40300, '您没有该事项的办理权限（不在可见范围内）');
      return false;
    }
    return true;
  };

  // 发起：事项详情（表单+起点权限+是否需指定审批人）
  r.get('/site/app/:id/start-info', (req, res) => {
    const app = engine.apps.find((a) => a.id === num(req.params.id));
    if (!app?.formVersionId || !app?.flowVersionId) return fail(res, 40404, '事项未发布');
    if (!checkVisible(req, res, app)) return;
    const form = engine.forms.find((f) => f.id === app.formVersionId)!;
    const flow = engine.flows.find((f) => f.id === app.flowVersionId)!;
    const start = flow.snapshot.nodes.find((n) => n.kind === 'start')!;
    const draftAuths = start.draftAuths?.[String(form.id)] ?? {};
    // 发起人指定：链式探测目标节点 + 按配置范围过滤可选人
    const chooseNode = findChooseNode(flow.snapshot.nodes, start.id);
    let nextCandidates: { id: number; name: string; department: string; group: string }[] | undefined;
    if (chooseNode) {
      nextCandidates = engine.users.all().filter((u) => u.status !== 'disabled')
        .filter((u) => inScope({ id: u.id, roles: u.roles, group: u.group, departmentId: u.departmentId }, chooseNode.assignee!.scope))
        .map((u) => ({ id: u.id, name: u.name, department: u.department, group: u.group ?? '' }));
    }
    ok(res, {
      app: { id: app.id, name: app.name, desc: app.desc },
      form: { versionId: form.id, version: form.version, components: formEngine.applyAuth({ components: form.snapshot.components }, draftAuths, { data: {} }, 'writable') },
      nextChoose: Boolean(chooseNode),
      nextNodeName: chooseNode?.name ?? '',
      nextCandidates,
    });
  });

  // 发起
  r.post('/site/instance/launch', (req, res) => {
    try {
      const { appId, data, vars, nextAssignees } = req.body ?? {};
      const app = engine.apps.find((a) => a.id === num(appId));
      if (!app) return fail(res, 40404, '事项不存在');
      if (!checkVisible(req, res, app)) return;
      const inst = engine.launch(P(req), { appId: num(appId), data: data ?? {}, vars: vars ?? {}, nextAssignees: (nextAssignees ?? []).map(num) });
      ok(res, { instanceId: inst.id, status: inst.status });
    } catch (e: any) {
      if (e.fieldErrors) return res.json({ e: 10049, m: e.message, d: e.fieldErrors });
      fail(res, 50000, e.message);
    }
  });

  // 被退回后重新提交
  r.post('/site/instance/:id/resubmit', (req, res) => {
    try {
      const inst = engine.resubmit(P(req), num(req.params.id), req.body?.data ?? {}, (req.body?.nextAssignees ?? []).map(num));
      ok(res, { instanceId: inst.id, status: inst.status });
    } catch (e: any) {
      if (e.fieldErrors) return res.json({ e: 10049, m: e.message, d: e.fieldErrors });
      fail(res, 50000, e.message);
    }
  });

  // 我的待办
  r.get('/site/task/list', (req, res) => {
    const box = String(req.query.box ?? 'todo');
    const p = P(req);
    if (box === 'todo') {
      const list = engine.todoOf(p.uid).map((t) => {
        const inst = engine.instances.find((i) => i.id === t.instanceId)!;
        const creator = engine.findUser(inst.createdBy);
        return { taskId: t.id, instanceId: inst.id, appName: inst.appSnapshot.name, nodeName: t.nodeName, creator: creator?.name, createdAt: t.createdAt, parentTaskId: t.parentTaskId ?? null };
      });
      return ok(res, list);
    }
    if (box === 'finished') {
      const logs = engine.dealtLogsOf(p.uid).slice(0, 200).map((l) => {
        const inst = engine.instances.find((i) => i.id === l.instanceId)!;
        return { logId: l.id, instanceId: l.instanceId, appName: inst.appSnapshot.name, nodeName: l.nodeName, action: l.action, comment: l.comment, dealtAt: l.createdAt, instanceStatus: inst.status };
      });
      return ok(res, logs);
    }
    return fail(res, 40004, '未知盒子');
  });

  r.get('/site/task/count', (req, res) => {
    const p = P(req);
    ok(res, { todo: engine.todoOf(p.uid).length });
  });

  // 认领（候选任务）
  r.post('/site/task/:id/claim', (req, res) => {
    const p = P(req);
    const t = engine.tasks.find((x) => x.id === num(req.params.id));
    if (!t) return fail(res, 40404, '任务不存在');
    if (!t.candidates.includes(p.uid)) return fail(res, 40300, '不在候选人中');
    engine.tasks.update((x) => x.id === t.id, { assignee: p.uid, status: 'claimed' });
    ok(res);
  });

  // 签批页：任务上下文
  r.get('/site/task/:id/deal-info', (req, res) => {
    const t = engine.tasks.find((x) => x.id === num(req.params.id));
    if (!t) return fail(res, 40404, '任务不存在');
    const inst = engine.mustInstance(t.instanceId);
    const flow = engine.flowOf(inst);
    const node = engine.nodeOf(flow, t.nodeId);
    const form = engine.formOf(inst);
    const nodeAuths = node.auths?.[String(inst.formVersionId)] ?? {};
    const creator = engine.findUser(inst.createdBy);
    // 下一环节若是"发起人指定"（沿链探测），下发候选人范围 + 发起人已暂存的人选（预审人可见、默认带入、可修改）
    let nextChoose: { nodeId: string; nodeName: string; candidates: { id: number; name: string; department: string }[]; selected: number[] } | null = null;
    const chooseNode = findChooseNode(flow.nodes, node.id);
    if (chooseNode) {
      const scope = chooseNode.assignee!.scope;
      const selected = (inst.pendingChoice ?? [])
        .map((uid) => engine.findUser(uid))
        .filter((p): p is Principal => Boolean(p) && inScope({ id: p!.uid, roles: p!.roles, group: p!.group, departmentId: p!.departmentId }, scope))
        .map((p) => p.uid);
      nextChoose = {
        nodeId: chooseNode.id, nodeName: chooseNode.name,
        candidates: engine.users.all()
          .filter((u) => u.status !== 'disabled')
          .filter((u) => inScope({ id: u.id, roles: u.roles, group: u.group, departmentId: u.departmentId }, scope))
          .map((u) => ({ id: u.id, name: u.name, department: u.department })),
        selected,
      };
    }
    ok(res, {
      task: { id: t.id, nodeId: t.nodeId, nodeName: t.nodeName, status: t.status, assignee: t.assignee, candidates: t.candidates, parentTaskId: t.parentTaskId ?? null, isSign: Boolean(t.parentTaskId) },
      instance: { id: inst.id, status: inst.status, progress: inst.progress, createdAt: inst.createdAt, creator: creator?.name, creatorDepartment: creator?.department, vars: inst.vars },
      node: { id: node.id, name: node.name, actions: t.parentTaskId ? [{ code: 'approve', name: '同意' }, { code: 'reject', name: '不同意' }] : (node.actions ?? []) },
      nextChoose,
      form: { versionId: form.versionId, version: form.version, components: formEngine.applyAuth({ components: form.components }, nodeAuths, { data: inst.data }) },
      data: inst.data,
      logs: engine.logs.filter((l) => l.instanceId === inst.id).sort((a, b) => a.id - b.id),
    });
  });

  // 审批提交
  r.post('/site/task/:id/deal', (req, res) => {
    try {
      const body = req.body ?? {};
      const out = engine.deal(P(req), num(req.params.id), {
        comment: body.comment ?? '',
        attachments: body.attachments ?? [],
        reader: (body.reader ?? []).map(num),
        operation: body.operation ?? { code: 'approve' },
        data: body.data ?? {},
        next: body.next ? { assignees: (body.next.assignees ?? []).map(num) } : undefined,
      });
      ok(res, { instanceId: out.instance.id, instanceStatus: out.instance.status, progress: out.instance.progress });
    } catch (e: any) {
      if (e.fieldErrors) return res.json({ e: 10049, m: e.message, d: e.fieldErrors });
      fail(res, 50000, e.message);
    }
  });

  // 催办
  r.post('/site/task/:id/urge', (req, res) => {
    try { engine.urge(P(req), num(req.params.id)); ok(res); } catch (e: any) { fail(res, 50000, e.message); }
  });

  // 我的申请
  r.get('/site/instance/mine', (req, res) => {
    const list = engine.instancesOf(P(req).uid).map((i) => ({
      id: i.id, appName: i.appSnapshot.name, status: i.status, progress: i.progress, createdAt: i.createdAt, finishedAt: i.finishedAt ?? null,
      currentNodeNames: i.currentNodes.map((n) => engine.nodeOf(engine.flowOf(i), n.nodeId).name),
    }));
    ok(res, list);
  });

  // 实例详情（表单数据+日志+流程图数据）
  r.get('/site/instance/:id/detail', (req, res) => {
    const inst = engine.mustInstance(num(req.params.id));
    const p = P(req);
    if (inst.createdBy !== p.uid && !p.roles.includes('admin')) {
      const hasTask = engine.tasks.find((t) => t.instanceId === inst.id && (t.assignee === p.uid || t.candidates.includes(p.uid)));
      const dealt = engine.logs.find((l) => l.instanceId === inst.id && l.actorUid === p.uid);
      if (!hasTask && !dealt) return fail(res, 40300, '无权查看');
    }
      const flow = engine.flowOf(inst);
      const form = engine.formOf(inst);
      const fileHash = (f: any) => ({ ...f, hash: sha256File(path.join(process.cwd(), 'uploads', path.basename(String(f.url ?? '')))) });
      const withHash = (files: any) => Array.isArray(files) ? files.map(fileHash) : fileHash(files);
      // 表单文件值补 hash、日志附件补 hash（供详情页展示 文件名/地址/SHA-256）
      const fileKeys = new Set(form.components.filter((c) => c.type === 'file').map((c) => c.key));
      const dataWithHash: any = { ...inst.data };
      for (const k of fileKeys) {
        const v = (inst.data as any)[k];
        if (!v) continue;
        dataWithHash[k] = withHash(v);
      }
      const logsWithHash = engine.logs
        .filter((l) => l.instanceId === inst.id)
        .sort((a, b) => a.id - b.id)
        .map((l) => (l.attachments?.length ? { ...l, attachments: withHash(l.attachments as any) } : l));
    const activeTaskIds = new Set(inst.currentNodes.flatMap((n) => n.taskIds));
    // 条件表达式 -> 人类可读描述（用表单字段标题）
    const describeExpr = (e: any): string => {
      if (!e || typeof e !== 'object') return '';
      if ((e as any).and) return (e as any).and.map(describeExpr).join(' 且 ');
      const [op, args] = Object.entries(e)[0] as [string, any[]];
      const rawKey = String(args?.[0]?.var ?? '').replace(/^form\./, '');
      const comp = form.components.find((c) => c.key === rawKey);
      const name = comp?.label ?? rawKey;
      const sym: Record<string, string> = { '==': '=', '!=': '≠', eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤' };
      return `${name} ${sym[op] ?? op} ${args?.[1] ?? ''}`;
    };
    // 路由边：start/userTask -> 下一跳（条件节点会拆成"满足/否则"两条边）
    const edges: { from: string; to: string; label?: string }[] = [];
    for (const n of flow.nodes) {
      if (n.kind === 'end') continue;
      const r = n.routing;
      if (!r || r.kind === 'sequential') edges.push({ from: n.id, to: r?.next ?? 'end' });
      else if (r.kind === 'parallel') for (const t of r.to ?? []) edges.push({ from: n.id, to: t, label: '并行' });
      else if (r.kind === 'conditional') {
        for (const b of r.branches ?? []) edges.push({ from: n.id, to: b.to, label: `满足：${describeExpr(b.when)}` });
        edges.push({ from: n.id, to: r.fallback ?? 'end', label: '否则' });
      }
    }
    // 节点状态：按该节点最后一次审批动作判定（而非实例终态）
    const nodeState = (n: import('../core/types.js').FlowNode): string => {
      if (n.kind === 'end') return inst.status === 'finished' ? 'done' : inst.status === 'rejected' ? 'rejected' : 'pending';
      if (inst.currentNodes.some((c) => c.nodeId === n.id)) return 'current';
      if (!inst.history.some((h) => h.nodeId === n.id)) return 'pending';
      const dealt = engine.tasks
        .filter((t) => t.instanceId === inst.id && t.nodeId === n.id && t.status === 'dealt' && Boolean(t.dealtAction))
        .sort((a, b) => b.id - a.id)[0];
      if (!dealt) return 'done';
      return ['reject', 'force-reject', 'sign-reject'].includes(dealt.dealtAction!) ? 'rejected' : 'done';
    };
    // 实际走过的边：从 start 重走 routing，条件分支只标记最终求值命中的分支
    const takenKeys = new Set<string>();
    const reached = new Set<string>(['start']);
    const walkQueue = ['start'];
    while (walkQueue.length) {
      const id = walkQueue.shift()!;
      const n = engine.nodeOf(flow, id);
      if (n.kind === 'end') continue;
      if (nodeState(n) === 'rejected') continue;
      // 只对真实发生过的节点标记出边（已处理或正在处理；start 必然已执行），未走到的节点不预判
      const visited = id === 'start' || inst.history.some((h) => h.nodeId === id) || inst.currentNodes.some((c) => c.nodeId === id);
      if (!visited) continue;
      const r = n.routing;
      const mark = (to: string) => { takenKeys.add(`${id}>${to}`); if (!reached.has(to)) { reached.add(to); walkQueue.push(to); } };
      if (!r || r.kind === 'sequential') mark(r?.next ?? 'end');
      else if (r.kind === 'parallel') for (const t of r.to ?? []) mark(t);
      else if (r.kind === 'conditional') {
        let matched = false;
        for (const b of r.branches ?? []) {
          if (evaluate(b.when, { vars: inst.vars as any, form: inst.data })) { mark(b.to); matched = true; }
        }
        if (!matched) mark(r.fallback ?? 'end');
      }
    }
    ok(res, {
      instance: { id: inst.id, name: inst.appSnapshot.name, status: inst.status, progress: inst.progress, createdAt: inst.createdAt, finishedAt: inst.finishedAt ?? null, vars: inst.vars },
      flow: {
        version: flow.version,
        nodes: flow.nodes.map((n) => {
          const handled = [...new Set(engine.logs
            .filter((l) => l.instanceId === inst.id && l.nodeId === n.id && l.actorUid !== inst.createdBy)
            .map((l) => l.actorName))];
          const pending = engine.tasks.filter((t) => t.instanceId === inst.id && t.nodeId === n.id && ['pending', 'claimed'].includes(t.status) && !t.parentTaskId);
          const waiting = [...new Set(pending.flatMap((t) => (t.assignee ? [t.assignee] : t.candidates))
            .map((uid) => engine.findUser(uid)?.name).filter(Boolean) as string[])];
          return {
            id: n.id, name: n.kind === 'start' ? '发起' : n.name, kind: n.kind,
            state: nodeState(n),
            allowForce: Boolean(n.allowForce),
            handlers: handled,
            candidates: waiting,
          };
        }),
        edges: edges.map((e) => ({ ...e, taken: takenKeys.has(`${e.from}>${e.to}`) })),
      },
      currentAllowForce: inst.status === 'running' && inst.currentNodes.some((rt) => engine.nodeOf(flow, rt.nodeId).allowForce),
      canExportPdf: inst.createdBy === p.uid || p.roles.includes('admin')
        || engine.tasks.filter((t) => t.instanceId === inst.id && (t.assignee === p.uid || t.candidates.includes(p.uid))).length > 0
        || engine.logs.filter((l) => l.instanceId === inst.id && l.actorUid === p.uid && !['提交', '重新提交', '撤销'].includes(l.action)).length > 0,
      nextChoose: Boolean(findChooseNode(flow.nodes, 'start')),
      nextCandidates: (() => {
        const cn = findChooseNode(flow.nodes, 'start');
        if (!cn) return undefined;
        return engine.users.all()
          .filter((u) => inScope({ id: u.id, roles: u.roles, group: u.group, departmentId: u.departmentId }, cn.assignee!.scope))
          .map((u) => ({ id: u.id, name: u.name, department: u.department, group: u.group ?? '' }));
      })(),
      form: { components: formEngine.applyAuth({ components: form.components }, {}, { data: inst.data }), data: dataWithHash },
      logs: logsWithHash,
      activeTaskIds: [...activeTaskIds],
    });
  });

  r.get('/site/instance/:id/variables', (req, res) => {
    ok(res, Object.values(engine.variablesOf(engine.mustInstance(num(req.params.id)))));
  });

  r.post('/site/instance/:id/revoke', (req, res) => {
    try { engine.revoke(P(req), num(req.params.id)); ok(res); } catch (e: any) { fail(res, 50000, e.message); }
  });

  // 管理员强制通过/退回（仅 allowForce 节点开放）
  r.post('/site/instance/:id/force', auth, requireRole('admin'), (req, res) => {
    try {
      const { action = 'approve', comment = '' } = req.body ?? {};
      const inst = engine.forceDeal(P(req), num(req.params.id), { action, comment });
      ok(res, { instanceId: inst.id, status: inst.status, progress: inst.progress });
    } catch (e: any) { fail(res, 50000, e.message); }
  });

  // 申请单 PDF 导出（发起人/审批员/管理员）
  r.get('/site/instance/:id/pdf', (req, res) => {
    try {
      const p = P(req);
      const inst = engine.mustInstance(num(req.params.id));
      const isOwner = inst.createdBy === p.uid;
      const isAdmin = p.roles.includes('admin');
      const isAuditor = engine.tasks.filter((t) => t.instanceId === inst.id && (t.assignee === p.uid || t.candidates.includes(p.uid))).length > 0
        || engine.logs.filter((l) => l.instanceId === inst.id && l.actorUid === p.uid && !['提交', '重新提交', '撤销'].includes(l.action)).length > 0;
      if (!isOwner && !isAdmin && !isAuditor) return fail(res, 40300, '无权导出该申请单（需发起人/审批员/管理员）');
      const p12 = ensureSigningP12(path.join(process.cwd(), 'data'));
      // 导出前补签：历史日志若缺个人签章（未签或盖章失败）则补盖
      engine.ensureInstanceSeals(inst.id);
      generateInstancePdf(engine, inst, p12).then((buf) => {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(`申请单-${inst.appSnapshot.name}-#${inst.id}.pdf`)}`);
        res.send(buf);
      }).catch((e: any) => fail(res, 50000, 'PDF 生成失败: ' + e.message));
    } catch (e: any) {
      fail(res, 50000, e.message);
    }
  });

  // 管理员更换审批人
  r.post('/site/instance/:id/change-approver', auth, requireRole('admin'), (req, res) => {
    try { engine.changeApprover(P(req), num(req.params.id), req.body?.mapping ?? {}); ok(res); } catch (e: any) { fail(res, 50000, e.message); }
  });

  // 消息中心（系统消息；知会单独在"我的知会"）
  r.get('/site/message/list', (req, res) => {
    const list = engine.messages.filter((m) => m.toUid === P(req).uid && m.kind !== 'read').sort((a, b) => b.id - a.id).slice(0, 100);
    ok(res, list);
  });

  // 我的知会（支持 事项/时间范围/关键字 筛选）
  r.get('/site/my-read', (req, res) => {
    const from = req.query.from ? req.query.from + ' 00:00:00' : '';
    const to = req.query.to ? req.query.to + ' 23:59:59' : '';
    const kw = String(req.query.keyword ?? '').toLowerCase();
    const appId = req.query.appId ? num(req.query.appId) : null;
    const list = engine.messages
      .filter((m) => m.toUid === P(req).uid && m.kind === 'read')
      .filter((m) => (!from || m.createdAt >= from) && (!to || m.createdAt <= to))
      .filter((m) => {
        if (!appId) return true;
        const inst = m.instanceId ? engine.instances.find((i) => i.id === m.instanceId) : undefined;
        return inst?.appId === appId;
      })
      .filter((m) => !kw || (m.title + m.body).toLowerCase().includes(kw))
      .sort((a, b) => b.id - a.id)
      .slice(0, 300)
      .map((m) => {
        const inst = m.instanceId ? engine.instances.find((i) => i.id === m.instanceId) : undefined;
        return { ...m, appName: inst?.appSnapshot.name ?? '', appId: inst?.appId ?? null };
      });
    ok(res, list);
  });

  // 我的知会导出 CSV
  r.get('/site/my-read/export', (req, res) => {
    const p = P(req);
    const from = req.query.from ? req.query.from + ' 00:00:00' : '';
    const to = req.query.to ? req.query.to + ' 23:59:59' : '';
    const kw = String(req.query.keyword ?? '').toLowerCase();
    const appId = req.query.appId ? num(req.query.appId) : null;
    const rows = engine.messages
      .filter((m) => m.toUid === p.uid && m.kind === 'read')
      .filter((m) => (!from || m.createdAt >= from) && (!to || m.createdAt <= to))
      .filter((m) => {
        if (!appId) return true;
        const inst = m.instanceId ? engine.instances.find((i) => i.id === m.instanceId) : undefined;
        return inst?.appId === appId;
      })
      .filter((m) => !kw || (m.title + m.body).toLowerCase().includes(kw))
      .sort((a, b) => b.id - a.id)
      .map((m) => {
        const inst = m.instanceId ? engine.instances.find((i) => i.id === m.instanceId) : undefined;
        return [m.createdAt, inst?.appSnapshot.name ?? '', inst ? '#' + inst.id : '', m.title, m.body, m.read ? '已读' : '未读'];
      });
    csvRes(res, '我的知会.csv', ['时间', '事项', '编号', '标题', '内容', '状态'], rows);
  });
  r.post('/site/message/read', (req, res) => {
    engine.messages.update((m) => m.toUid === P(req).uid && !m.read && (req.body?.ids ? (req.body.ids as number[]).includes(m.id) : true), { read: true });
    ok(res);
  });

  // 按事项查询/导出（auth + 审核权限校验，非 admin 也可用）
    // 按事项查询/导出实例数据（管理员，或有审核权限者：处理过/被指派过该事项任务的人）
  const canAudit = (p: Principal, appId: number): boolean => {
    if (p.roles.includes('admin')) return true;
    const instIds = new Set(engine.instances.filter((i) => i.appId === appId).map((i) => i.id));
    if (engine.tasks.filter((t) => instIds.has(t.instanceId) && (t.assignee === p.uid || t.candidates.includes(p.uid))).length) return true;
    // 仅审批行为授权（本人发起/撤销不构成审核权限）
    if (engine.logs.filter((l) => instIds.has(l.instanceId) && l.actorUid === p.uid && !['提交', '重新提交', '撤销', '知会'].includes(l.action)).length) return true;
    return false;
  };
  const queryInstances = (appId: number, q: { from?: string; to?: string; status?: string; keyword?: string }) => {
    const from = q.from ? q.from + ' 00:00:00' : '';
    const to = q.to ? q.to + ' 23:59:59' : '';
    return engine.instances
      .filter((i) => i.appId === appId)
      .filter((i) => (!from || i.createdAt >= from) && (!to || i.createdAt <= to))
      .filter((i) => !q.status || i.status === q.status)
      .filter((i) => {
        if (!q.keyword) return true;
        const creator = engine.findUser(i.createdBy);
        const hay = `${creator?.name ?? ''} ${creator?.number ?? ''} ${JSON.stringify(i.data)}`;
        return hay.toLowerCase().includes(q.keyword.toLowerCase());
      })
      .sort((a, b) => b.id - a.id);
  };
  const instanceRows = (list: Instance2[]) => list.map((i) => {
    const creator = engine.findUser(i.createdBy);
    const flow = engine.flowOf(i);
    return {
      inst: i,
      creatorName: creator?.name ?? '', creatorDepartment: creator?.department ?? '',
      currentNodeNames: i.currentNodes.map((n) => flow.nodes.find((x) => x.id === n.nodeId)?.name ?? n.nodeId),
    };
  });
  type Instance2 = import('../core/types.js').Instance;

  r.get('/system/app/:id/instances', auth, (req, res) => {
    const p = P(req);
    const appId = num(req.params.id);
    if (!canAudit(p, appId)) return fail(res, 40300, '无权查看该事项数据（需管理员或参与审核）');
    const list = queryInstances(appId, { from: req.query.from as string, to: req.query.to as string, status: req.query.status as string, keyword: req.query.keyword as string });
    ok(res, instanceRows(list).map((r) => ({
      id: r.inst.id, status: r.inst.status, progress: r.inst.progress, createdAt: r.inst.createdAt, finishedAt: r.inst.finishedAt ?? null,
      creator: r.creatorName, department: r.creatorDepartment, currentNodes: r.currentNodeNames, data: r.inst.data,
    })));
  });

  r.get('/system/app/:id/export', auth, (req, res) => {
    const p = P(req);
    const appId = num(req.params.id);
    if (!canAudit(p, appId)) return fail(res, 40300, '无权导出该事项数据');
    const app = engine.apps.find((a) => a.id === appId);
    const list = queryInstances(appId, { from: req.query.from as string, to: req.query.to as string, status: req.query.status as string, keyword: req.query.keyword as string });
    const formRow = engine.forms.find((f) => f.id === (engine.apps.find((a) => a.id === appId)?.formVersionId ?? -1));
    const comps = formRow?.snapshot.components ?? [];
    const statusName = (s: string) => ({ draft: '草稿', running: '进行中', suspended: '挂起', finished: '已完成', revoked: '已撤销', rejected: '已否决' }[s] ?? s);
    const headers = ['编号', '事项', '发起人', '发起人部门', '状态', '进度%', '提交时间', '完成时间', '当前节点', ...comps.map((c) => c.label)];
    const rows = instanceRows(list).map((r) => [
      r.inst.id, app?.name ?? appId, r.creatorName, r.creatorDepartment, statusName(r.inst.status), r.inst.progress,
      r.inst.createdAt, r.inst.finishedAt ?? '', r.currentNodeNames.join('、'),
      ...comps.map((c) => {
        const v = r.inst.data[c.key];
        return Array.isArray(v) ? v.join('、') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
      }),
    ]);
    csvRes(res, `${app?.name ?? '事项'}-数据导出.csv`, headers, rows);
  });

  // =============== 管理端 /system（admin + TOTP 钩子）===============
  r.use('/system', ...sys);


  r.get('/system/users', (_req, res) => ok(res, engine.users.all().map(({ passHash, salt, ...u }) => u)));

  // ===== 用户管理 =====
  const publicUser = (u: any) => { const { passHash, salt, ...rest } = u; return rest; };

  r.post('/system/users', (req, res) => {
    const { username, password, name, number = '', departmentId, roles = [], group = '', status = 'active' } = req.body ?? {};
    if (!username || !password || !name || departmentId === undefined) return fail(res, 40001, '账号/密码/姓名/部门必填');
    if (engine.users.find((u) => u.username === username)) return fail(res, 40001, `账号 "${username}" 已存在`);
    const dept = engine.departments.find((d) => d.deptId === num(departmentId));
    if (!dept) return fail(res, 40001, '部门不存在');
    const salt = makeSalt();
    const row = engine.users.insert({ id: 0, username, passHash: hashPassword(password, salt), salt, name, number: String(number), department: dept.name, departmentId: dept.deptId, roles: roles.map(String), group: String(group) || undefined, status });
    ok(res, publicUser(row));
  });

  r.put('/system/users/:id', (req, res) => {
    const u = engine.users.find((x) => x.id === num(req.params.id));
    if (!u) return fail(res, 40404, '用户不存在');
    const patch: any = {};
    const b = req.body ?? {};
    if (b.name !== undefined) patch.name = String(b.name);
    if (b.number !== undefined) patch.number = String(b.number);
    if (b.roles !== undefined) patch.roles = (b.roles as unknown[]).map(String);
    if (b.group !== undefined) patch.group = String(b.group) || undefined;
    if (b.departmentId !== undefined) {
      const dept = engine.departments.find((d) => d.deptId === num(b.departmentId));
      if (!dept) return fail(res, 40001, '部门不存在');
      patch.departmentId = dept.deptId; patch.department = dept.name;
    }
    if (b.status !== undefined) {
      if (u.id === P(req).uid && b.status === 'disabled') return fail(res, 40001, '不能禁用自己');
      if (u.roles.includes('admin') && b.status === 'disabled' && engine.users.filter((x) => x.roles.includes('admin') && x.status !== 'disabled' && x.id !== u.id).length === 0) {
        return fail(res, 40001, '至少保留一个启用的管理员');
      }
      patch.status = b.status;
    }
    engine.users.update((x) => x.id === u.id, patch);
    ok(res, publicUser(engine.users.find((x) => x.id === u.id)));
  });

  r.post('/system/users/:id/reset-password', (req, res) => {
    const u = engine.users.find((x) => x.id === num(req.params.id));
    if (!u) return fail(res, 40404, '用户不存在');
    const { password } = req.body ?? {};
    if (!password || String(password).length < 6) return fail(res, 40001, '密码至少 6 位');
    const salt = makeSalt();
    engine.users.update((x) => x.id === u.id, { salt, passHash: hashPassword(String(password), salt) });
    ok(res);
  });

  r.delete('/system/users/:id', (req, res) => {
    const u = engine.users.find((x) => x.id === num(req.params.id));
    if (!u) return fail(res, 40404, '用户不存在');
    if (u.id === P(req).uid) return fail(res, 40001, '不能删除自己');
    const hasRef =
      engine.instances.filter((i) => i.createdBy === u.id).length ||
      engine.tasks.filter((t) => t.assignee === u.id || t.candidates.includes(u.id)).length ||
      engine.logs.filter((l) => l.actorUid === u.id).length;
    if (hasRef) return fail(res, 40001, '该用户存在流程记录，无法删除；建议改用"禁用"');
    engine.users.remove((x) => x.id === u.id);
    ok(res);
  });

  // ===== API 密钥（第三方平台对接）=====
  r.get('/system/apikeys', (_req, res) => {
    ok(res, engine.apikeys.all().sort((a, b) => b.id - a.id).map((k) => ({
      id: k.id, name: k.name,
      keyMasked: k.key.slice(0, 10) + '****' + k.key.slice(-4),
      status: k.status, createdAt: k.createdAt,
    })));
  });

  r.post('/system/apikeys', (req, res) => {
    const { name } = req.body ?? {};
    if (!name) return fail(res, 40001, '请填写密钥用途名称');
    const key = 'ak_' + crypto.randomBytes(24).toString('hex');
    const row = engine.apikeys.insert({ id: 0, key, name: String(name), status: 'active', createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19), createdBy: P(req).uid });
    ok(res, { id: row.id, name: row.name, key: row.key, status: row.status }); // 完整 key 仅此一次返回
  });

  r.post('/system/apikeys/:id/toggle', (req, res) => {
    const row = engine.apikeys.find((k) => k.id === num(req.params.id));
    if (!row) return fail(res, 40404, '密钥不存在');
    engine.apikeys.update((k) => k.id === row.id, { status: row.status === 'active' ? 'revoked' : 'active' });
    ok(res, { status: row.status === 'active' ? 'revoked' : 'active' });
  });

  r.delete('/system/apikeys/:id', (req, res) => {
    const row = engine.apikeys.find((k) => k.id === num(req.params.id));
    if (!row) return fail(res, 40404, '密钥不存在');
    engine.apikeys.remove((k) => k.id === row.id);
    ok(res);
  });

  // ===== 个人签章（数字证书）管理 =====
  r.get('/system/seals', (_req, res) => {
    ok(res, engine.users.all().map((u) => {
      const info = getSealInfo(u.id);
      return {
        uid: u.id, name: u.name, number: u.number, department: u.department,
        hasSeal: Boolean(info),
        subject: info?.subject ?? '', serial: info?.serial ?? '',
        fingerprint: info?.fingerprint ?? '', createdAt: info?.createdAt ?? '',
      };
    }));
  });

  r.post('/system/seals/:uid/reset', (req, res) => {
    const uid = num(req.params.uid);
    const u = engine.findUser(uid);
    if (!u) return fail(res, 40404, '用户不存在');
    resetSeal(uid);
    ok(res);
  });

  // ===== 角色（权限组）管理 =====
  r.get('/system/roles', (_req, res) => {
    ok(res, engine.roles.all().map((r) => ({ ...r, usersCount: engine.users.filter((u) => u.roles.includes(r.key)).length })));
  });
  r.post('/system/roles', (req, res) => {
    const { key, name, desc = '' } = req.body ?? {};
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(String(key ?? ''))) return fail(res, 40001, '角色 key 需为小写字母开头的 2-24 位字母/数字/下划线');
    if (!name) return fail(res, 40001, '角色名称必填');
    if (engine.roles.find((r) => r.key === key)) return fail(res, 40001, `角色 "${key}" 已存在`);
    ok(res, engine.roles.insert({ id: 0, key, name, desc: String(desc), builtin: false }));
  });
  r.delete('/system/roles/:key', (req, res) => {
    const role = engine.roles.find((r) => r.key === req.params.key);
    if (!role) return fail(res, 40404, '角色不存在');
    if (role.builtin) return fail(res, 40001, '内置角色不可删除');
    const used = engine.users.filter((u) => u.roles.includes(role.key)).length;
    if (used) return fail(res, 40001, `仍有 ${used} 个用户持有该角色，请先移除`);
    engine.roles.remove((r) => r.key === role.key);
    ok(res);
  });

  // ===== 部门管理 =====
  r.get('/system/departments', (_req, res) => {
    ok(res, engine.departments.all().map((d) => ({ ...d, usersCount: engine.users.filter((u) => u.departmentId === d.deptId).length })));
  });
  r.post('/system/departments', (req, res) => {
    const { name } = req.body ?? {};
    if (!name) return fail(res, 40001, '部门名称必填');
    if (engine.departments.find((d) => d.name === name)) return fail(res, 40001, `部门 "${name}" 已存在`);
    const deptId = Math.max(0, ...engine.departments.all().map((d) => d.deptId)) + 1;
    ok(res, engine.departments.insert({ id: 0, deptId, name }));
  });
  r.put('/system/departments/:id', (req, res) => {
    const d = engine.departments.find((x) => x.id === num(req.params.id));
    if (!d) return fail(res, 40404, '部门不存在');
    const { name } = req.body ?? {};
    if (!name) return fail(res, 40001, '部门名称必填');
    engine.departments.update((x) => x.id === d.id, { name });
    engine.users.update((u) => u.departmentId === d.deptId, { department: String(name) });
    ok(res);
  });

  r.get('/system/app', (_req, res) => ok(res, engine.apps.all()));
  r.post('/system/app', (req, res) => {
    const { name, desc = '', icon = '', visibility } = req.body ?? {};
    if (!name) return fail(res, 40001, '事项名称必填');
    ok(res, engine.apps.insert({ id: 0, name, desc, icon, formVersionId: null, flowVersionId: null, visibility: validVisibility(visibility) }));
  });
  r.put('/system/app/:id', (req, res) => {
    const app = engine.apps.find((a) => a.id === num(req.params.id));
    if (!app) return fail(res, 40404, '事项不存在');
    const b = req.body ?? {};
    const patch: any = {};
    if (b.name !== undefined) patch.name = String(b.name);
    if (b.desc !== undefined) patch.desc = String(b.desc);
    if (b.icon !== undefined) patch.icon = String(b.icon);
    if (b.visibility !== undefined) patch.visibility = validVisibility(b.visibility);
    engine.apps.update((a) => a.id === app.id, patch);
    ok(res, engine.apps.find((a) => a.id === app.id));
  });
  const validVisibility = (v: any) => {
    if (!v || v.kind === 'all' || !v.kind) return undefined;
    if (!['role', 'group', 'department', 'fixed'].includes(v.kind)) return undefined;
    if (v.value === '' || v.value === undefined || (Array.isArray(v.value) && !v.value.length)) return undefined;
    return { kind: v.kind, value: v.kind === 'department' ? Number(v.value) : v.kind === 'fixed' ? (v.value as number[]).map(Number) : String(v.value) };
  };
  r.post('/system/app/:id/publish', (req, res) => {
    const app = engine.apps.find((a) => a.id === num(req.params.id));
    if (!app) return fail(res, 40404, '事项不存在');
    const { formId, flowId, allowForce } = req.body ?? {};
    const form = engine.forms.find((f) => f.id === num(formId) && f.status === 'published');
    const flow = engine.flows.find((f) => f.id === num(flowId) && f.status === 'published');
    if (!form && !flow) return fail(res, 40001, '表单与流程都未发布：请先在表单设计/流程设计中保存并发布版本');
    if (!form) return fail(res, 40001, '表单版本未发布：请先在表单设计中点击"发布此版本"');
    if (!flow) return fail(res, 40001, '流程版本未发布：请先在流程设计中点击"发布此版本"');
    // 发布时可选：是否允许后一级（各审批节点）被管理员强制审批
    if (typeof allowForce === 'boolean') {
      engine.flows.update((f) => f.id === flow.id, {
        snapshot: { ...flow.snapshot, nodes: flow.snapshot.nodes.map((n) => (n.kind === 'userTask' ? { ...n, allowForce } : n)) },
      });
    }
    engine.apps.update((a) => a.id === app.id, { formVersionId: form.id, flowVersionId: flow.id });
    ok(res, engine.apps.find((a) => a.id === app.id));
  });

  // 表单设计
  r.get('/system/form', (req, res) => ok(res, engine.forms.filter((f) => f.appId === num(req.query.appId)).sort((a, b) => b.id - a.id)));
  r.post('/system/form', (req, res) => {
    const { appId, components } = req.body ?? {};
    const app = engine.apps.find((a) => a.id === num(appId));
    if (!app) return fail(res, 40404, '事项不存在');
    const exist = engine.forms.filter((f) => f.appId === app.id).length;
    const row = engine.forms.insert({ id: 0, appId: app.id, version: `v${exist + 1}`, status: 'draft', snapshot: { components: components ?? [] } });
    ok(res, row);
  });
  r.post('/system/form/:id/publish', (req, res) => {
    const row = engine.forms.find((f) => f.id === num(req.params.id));
    if (!row) return fail(res, 40404, '表单版本不存在');
    engine.forms.update((f) => f.id === row.id, { status: 'published' });
    // 自动绑定到所属事项（最新发布版本即刻生效）
    engine.apps.update((a) => a.id === row.appId, { formVersionId: row.id });
    ok(res, { ...row, status: 'published' });
  });

  // 流程设计
  r.get('/system/flow', (req, res) => ok(res, engine.flows.filter((f) => f.appId === num(req.query.appId)).sort((a, b) => b.id - a.id)));
  r.get('/system/flow/:id', (req, res) => {
    const row = engine.flows.find((f) => f.id === num(req.params.id));
    if (!row) return fail(res, 40404, '流程版本不存在');
    ok(res, row);
  });
  r.post('/system/flow', (req, res) => {
    const { appId, nodes, variables = [] } = req.body ?? {};
    const app = engine.apps.find((a) => a.id === num(appId));
    if (!app) return fail(res, 40404, '事项不存在');
    const exist = engine.flows.filter((f) => f.appId === app.id).length;
    const row = engine.flows.insert({ id: 0, appId: app.id, version: `v${exist + 1}`, status: 'draft', snapshot: { nodes: nodes ?? [], variables } });
    ok(res, row);
  });
  r.post('/system/flow/:id/publish', (req, res) => {
    const row = engine.flows.find((f) => f.id === num(req.params.id));
    if (!row) return fail(res, 40404, '流程版本不存在');
    const flow = row.snapshot;
    if (!flow.nodes.some((n) => n.kind === 'start') || !flow.nodes.some((n) => n.kind === 'end')) return fail(res, 40001, '流程必须包含发起与结束节点');
    engine.flows.update((f) => f.id === row.id, { status: 'published' });
    // 自动绑定到所属事项（最新发布版本即刻生效）
    engine.apps.update((a) => a.id === row.appId, { flowVersionId: row.id });
    ok(res, { ...row, status: 'published' });
  });

  // 统计
  r.get('/system/stats', (_req, res) => {
    const insts = engine.instances.all();
    ok(res, {
      total: insts.length,
      running: insts.filter((i) => i.status === 'running').length,
      finished: insts.filter((i) => i.status === 'finished').length,
      rejected: insts.filter((i) => i.status === 'rejected').length,
      byApp: engine.apps.all().map((a) => ({ name: a.name, count: insts.filter((i) => i.appId === a.id).length })),
    });
  });

  return r;
}

export type { FieldError, Json };