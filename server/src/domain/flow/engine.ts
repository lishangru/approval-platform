import type {
  ApprovalLog, FlowNode, FlowSnapshot, FormSnapshot, Instance, Json, JsonValue,
  Message, Principal, Task,
} from '../../core/types.js';
import type { JsonStore, Table } from '../../core/store.js';
import { bus } from '../../core/events.js';
import { formEngine } from '../form/engine.js';
import { assigneeRegistry, type AssigneeCtx } from './assignees.js';
import { routingRegistry } from './routing.js';
import { actionRegistry, type DealInput } from './actions.js';
import { ensureSeal, getSealInfo, signWithSeal } from '../../services/seal.js';

export interface UserRow {
  id: number; username: string; passHash: string; salt: string;
  name: string; number: string; department: string; departmentId: number; roles: string[];
  group?: string;              // 用户组（如"学工处-审核组"），可作为审批人规则
  status?: 'active' | 'disabled';
}
export interface RoleRow { id: number; key: string; name: string; desc: string; builtin: boolean }
export interface DeptRow { id: number; deptId: number; name: string }
export interface ApiKeyRow { id: number; key: string; name: string; status: 'active' | 'revoked'; createdAt: string; createdBy: number }
export interface AppRow {
  id: number; name: string; desc: string; icon: string; formVersionId: number | null; flowVersionId: number | null;
  visibility?: { kind: 'all' | 'role' | 'group' | 'department' | 'fixed'; value?: any };  // 可见/可办理范围（默认全部）
}
export interface FormRow { id: number; appId: number; version: string; status: 'draft' | 'published'; snapshot: { components: FormSnapshot['components'] } }
export interface FlowRow { id: number; appId: number; version: string; status: 'draft' | 'published'; snapshot: { nodes: FlowNode[]; variables: FlowSnapshot['variables'] } }

export class WorkflowEngine {
  users: Table<UserRow>;
  apps: Table<AppRow>;
  forms: Table<FormRow>;
  flows: Table<FlowRow>;
  instances: Table<Instance>;
  tasks: Table<Task>;
  logs: Table<ApprovalLog>;
  messages: Table<Message>;
  roles: Table<RoleRow>;
  departments: Table<DeptRow>;
  apikeys: Table<ApiKeyRow>;

  constructor(private store: JsonStore) {
    this.users = store.table<UserRow>('users');
    this.apps = store.table<AppRow>('apps');
    this.forms = store.table<FormRow>('forms');
    this.flows = store.table<FlowRow>('flows');
    this.instances = store.table<Instance>('instances');
    this.tasks = store.table<Task>('tasks');
    this.logs = store.table<ApprovalLog>('logs');
    this.messages = store.table<Message>('messages');
    this.roles = store.table<RoleRow>('roles');
    this.departments = store.table<DeptRow>('departments');
    this.apikeys = store.table<ApiKeyRow>('apikeys');
  }

  // ===== 用户 =====
  findUser(uid: number): Principal | undefined {
    const u = this.users.find((r) => r.id === uid);
    return u ? { uid: u.id, name: u.name, number: u.number, department: u.department, departmentId: u.departmentId, roles: u.roles, group: u.group } : undefined;
  }
  findRoleUsers(role: string, opts: { departmentId?: number } = {}): Principal[] {
    return this.users
      .filter((u) => u.status !== 'disabled')
      .filter((u) => (role === '*' || u.roles.includes(role)) && (opts.departmentId === undefined || u.departmentId === opts.departmentId))
      .map((u) => ({ uid: u.id, name: u.name, number: u.number, department: u.department, departmentId: u.departmentId, roles: u.roles, group: u.group }));
  }
  groupMembers(group: string): Principal[] {
    return this.users
      .filter((u) => u.status !== 'disabled' && u.group === group)
      .map((u) => ({ uid: u.id, name: u.name, number: u.number, department: u.department, departmentId: u.departmentId, roles: u.roles, group: u.group }));
  }
  principalOf(uid: number): Principal {
    const p = this.findUser(uid);
    if (!p) throw new Error('用户不存在');
    return p;
  }

  // ===== 快照 =====
  formOf(instance: Instance): FormSnapshot {
    const row = this.forms.find((f) => f.id === instance.formVersionId);
    if (!row) throw new Error('表单版本快照不存在');
    return { formId: row.id, version: row.version, versionId: row.id, components: row.snapshot.components };
  }
  flowOf(instance: Instance): FlowSnapshot {
    const row = this.flows.find((f) => f.id === instance.flowVersionId);
    if (!row) throw new Error('流程版本快照不存在');
    return { flowId: row.id, version: row.version, versionId: row.id, nodes: row.snapshot.nodes, variables: row.snapshot.variables };
  }
  nodeOf(flow: FlowSnapshot, nodeId: string): FlowNode {
    const n = flow.nodes.find((x) => x.id === nodeId);
    if (!n) throw new Error(`流程节点不存在: ${nodeId}`);
    return n;
  }

  // ===== 日志 / 消息 =====
  writeLog(l: Omit<ApprovalLog, 'id' | 'createdAt'>): ApprovalLog {
    return this.logs.insert({ ...l, createdAt: now() } as ApprovalLog);
  }
  notify(uids: number[], title: string, body: string, instanceId: number, taskId?: number, kind: 'notify' | 'read' = 'notify') {
    const uniq = [...new Set(uids)].filter(Boolean);
    for (const uid of uniq) {
      this.messages.insert({ toUid: uid, title, body, instanceId, taskId, kind, read: false, createdAt: now() } as Message);
    }
    bus.emitEvent({ type: 'Notify', toUids: uniq, title, body, instanceId, taskId });
  }

  // ===== 发起 =====
  launch(actor: Principal, input: { appId: number; data: Json; vars?: Json; nextAssignees?: number[] }): Instance {
    const app = this.apps.find((a) => a.id === input.appId);
    if (!app?.formVersionId || !app?.flowVersionId) throw new Error('事项未发布');
    const formRow = this.forms.find((f) => f.id === app.formVersionId)!;
    const flowRow = this.flows.find((f) => f.id === app.flowVersionId)!;
    const flow: FlowSnapshot = { flowId: flowRow.id, version: flowRow.version, versionId: flowRow.id, nodes: flowRow.snapshot.nodes, variables: flowRow.snapshot.variables };
    const start = flow.nodes.find((n) => n.kind === 'start')!;
    const schema = { components: formRow.snapshot.components };

    const data = formEngine.normalize(schema, input.data, { data: input.data, actor });
    const errs = formEngine.validate(schema, data, start.draftAuths?.[String(formRow.id)] ?? {}, { data, actor }, 'writable');
    if (errs.length) throw Object.assign(new Error('表单校验失败'), { fieldErrors: errs });

    const inst = this.instances.insert({
      id: 0,
      appId: app.id, appSnapshot: { name: app.name },
      flowVersionId: flowRow.id, formVersionId: formRow.id,
      data, vars: input.vars ?? {},
      status: 'running',
      currentNodes: [], history: [],
      pendingChoice: input.nextAssignees?.length ? input.nextAssignees : undefined,
      createdBy: actor.uid, createdAt: now(), progress: 0,
    });
    this.writeLog({
      instanceId: inst.id, taskId: null, nodeId: start.id, nodeName: '发起',
      actorUid: actor.uid, actorName: actor.name, action: '提交',
      comment: String(input.vars?.desc ?? ''), attachments: [], snapshot: { data },
    });
    this.routeFrom(inst, start.id, actor, { operation: { code: 'submit' }, next: { assignees: input.nextAssignees } });
    bus.emitEvent({ type: 'InstanceSubmitted', instanceId: inst.id, appId: app.id, createdBy: actor.uid });
    return this.instances.find((i) => i.id === inst.id)!;
  }

  // 发起人被退回后重新提交
  resubmit(actor: Principal, instanceId: number, data: Json, nextAssignees?: number[]): Instance {
    const inst = this.mustInstance(instanceId);
    if (inst.createdBy !== actor.uid) throw new Error('只有发起人可以修改重报');
    const node = inst.currentNodes.find((n) => n.nodeId === 'start');
    if (!node) throw new Error('当前不在待修改状态');
    const formRow = this.forms.find((f) => f.id === inst.formVersionId)!;
    const schema = { components: formRow.snapshot.components };
    const start = this.flowOf(inst).nodes.find((n) => n.kind === 'start')!;
    const merged = { ...inst.data, ...data };
    const norm = formEngine.normalize(schema, merged, { data: merged, actor });
    const errs = formEngine.validate(schema, norm, start.draftAuths?.[String(formRow.id)] ?? {}, { data: norm, actor }, 'writable');
    if (errs.length) throw Object.assign(new Error('表单校验失败'), { fieldErrors: errs });
    this.instances.update((i) => i.id === inst.id, { data: norm });
    for (const tid of node.taskIds) this.tasks.update((t) => t.id === tid, { status: 'dealt', dealtAt: now(), dealtBy: actor.uid, dealtAction: 'resubmit' });
    this.writeLog({
      instanceId: inst.id, taskId: node.taskIds[0] ?? null, nodeId: 'start', nodeName: '发起',
      actorUid: actor.uid, actorName: actor.name, action: '重新提交', comment: '', attachments: [], snapshot: { data: norm },
    });
    inst.currentNodes = inst.currentNodes.filter((n) => n.nodeId !== 'start');
    if (node.taskIds[0]) inst.history.push({ nodeId: 'start', taskIds: node.taskIds });
    if (nextAssignees?.length) inst.pendingChoice = nextAssignees;
    this.recomputeProgress(inst);
    this.routeFrom(inst, 'start', actor, { operation: { code: 'submit' }, next: nextAssignees?.length ? { assignees: nextAssignees } : undefined });
    return this.instances.find((i) => i.id === inst.id)!;
  }

  // ===== 路由推进 =====
  routeFrom(instance: Instance, fromNodeId: string, actor: Principal, input: DealInput) {
    const flow = this.flowOf(instance);
    const node = this.nodeOf(flow, fromNodeId);
    const spec = node.routing ?? { kind: 'sequential' as const, next: 'end' };
    const ctx = { vars: this.exprVars(instance) as any, form: instance.data, fromNodeId };
    const targets = routingRegistry.get(spec.kind).next(spec, ctx, flow.nodes);
    // 关闭来源节点运行时 → 历史
    const rt = instance.currentNodes.find((n) => n.nodeId === fromNodeId);
    if (rt) {
      rt.finishedAt = now();
      instance.currentNodes = instance.currentNodes.filter((n) => n !== rt);
      instance.history.push({ nodeId: fromNodeId, taskIds: rt.taskIds });
      this.instances.update((i) => i.id === instance.id, { currentNodes: instance.currentNodes, history: instance.history });
    }
    for (const t of targets) {
      if (t === 'end' || this.nodeOf(flow, t).kind === 'end') continue; // end 在最后统一判断
      this.openNode(instance, t, { chosen: input?.next?.assignees });
    }
    if (targets.some((t) => t === 'end' || this.nodeOf(flow, t).kind === 'end')) {
      if (instance.currentNodes.length === 0) this.finish(instance, 'finished');
    }
  }

  openNode(instance: Instance, nodeId: string, opts: { chosen?: number[] } = {}) {
    const flow = this.flowOf(instance);
    const node = this.nodeOf(flow, nodeId);
    if (!node.assignee) throw new Error(`节点 ${nodeId} 未配置审批人`);
    const initiator = this.principalOf(instance.createdBy);
    // 发起人指定：优先用本次传入的选择，否则消费实例上暂存的选择（跨节点场景）
    const isChooseNode = node.assignee.kind === 'initiator_choose';
    const chosen = opts.chosen?.length ? opts.chosen : (isChooseNode ? instance.pendingChoice : undefined);
    // 暂存的选择一经到达指定节点即视为消费（无论是否在范围内，避免过期选择反复阻塞流程）
    if (isChooseNode && instance.pendingChoice?.length) {
      instance.pendingChoice = undefined;
      this.instances.update((i) => i.id === instance.id, { pendingChoice: undefined });
    }
    const actx: AssigneeCtx = {
      initiator,
      chosen,
      vars: instance.vars, form: instance.data,
      findUser: (u) => this.findUser(u),
      findRoleUsers: (role, o) => this.findRoleUsers(role, o),
    };
    const people = assigneeRegistry.get(node.assignee.kind).resolve(node.assignee, actx);
    if (!people.length) {
      const scope = node.assignee.scope;
      const scopeName = !scope || scope.kind === 'all' ? '全部人员'
        : scope.kind === 'role' ? `角色「${scope.value}」`
        : scope.kind === 'group' ? `用户组「${scope.value}」`
        : scope.kind === 'department' ? '指定部门'
        : '指定人员';
      throw new Error(`请为节点「${node.name}」指定审批人（候选人范围：${scopeName}），可在处理上一环节时选择`);
    }
    if (!people.length) throw Object.assign(new Error(`节点「${node.name}」无法解析审批人`), { code: 'NO_ASSIGNEE' });
    const dealMode = node.assignee.dealMode ?? 'or';
    const rt = { nodeId, taskIds: [] as number[], enteredAt: now() };
    const created: Task[] = [];
    if (dealMode === 'all') {
      for (const p of people) {
        const t = this.tasks.insert({
          id: 0, instanceId: instance.id, nodeId, nodeName: node.name,
          assignee: p.uid, candidates: [p.uid], status: 'pending', createdAt: now(),
        });
        rt.taskIds.push(t.id); created.push(t);
      }
    } else {
      const t = this.tasks.insert({
        id: 0, instanceId: instance.id, nodeId, nodeName: node.name,
        assignee: null, candidates: people.map((p) => p.uid), status: 'pending', createdAt: now(),
      });
      rt.taskIds.push(t.id); created.push(t);
    }
    instance.currentNodes.push(rt);
    this.instances.update((i) => i.id === instance.id, { currentNodes: instance.currentNodes });
    const uids = people.map((p) => p.uid);
    for (const t of created) {
      bus.emitEvent({ type: 'TaskCreated', instanceId: instance.id, taskId: t.id, nodeId, nodeName: node.name, assignee: t.assignee, candidates: t.candidates });
    }
    this.notify(uids, '您有新的待办任务', `事项「${instance.appSnapshot.name}」已到达节点「${node.name}」`, instance.id);
    this.setVars(instance, { node_id: [node.id] as unknown as string, node_name: [node.name] as unknown as string });
  }

  // ===== 审批 =====
  deal(actor: Principal, taskId: number, input: DealInput): { instance: Instance; task: Task } {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('任务不存在');
    if (!['pending', 'claimed'].includes(task.status)) throw new Error('任务当前状态不可处理');
    const canDeal = task.assignee === actor.uid || task.candidates.includes(actor.uid) || actor.roles.includes('admin');
    if (!canDeal) throw new Error('无权处理该任务');
    const logWatermark = this.logs.all().reduce((m, l) => Math.max(m, l.id), 0);

    // —— 加签子任务：处理后归还主任务 ——
    if (task.parentTaskId) {
      const fieldErrs = this.checkDealInput(input, null);
      if (fieldErrs) throw fieldErrs;
      const isReject = input.operation.code !== 'approve';
      this.tasks.update((t) => t.id === task.id, { status: 'dealt', dealtAt: now(), dealtBy: actor.uid, dealtAction: isReject ? 'sign-reject' : 'sign' });
      this.writeLog({
        instanceId: task.instanceId, taskId: task.id, nodeId: task.nodeId, nodeName: task.nodeName + '（加签）',
        actorUid: actor.uid, actorName: actor.name, action: '加签意见',
        comment: input.comment ?? '', attachments: input.attachments ?? [], snapshot: { deal: input as unknown as Json },
      });
      const parent = this.tasks.find((t) => t.id === task.parentTaskId)!;
      const siblings = this.tasks.filter((t) => t.parentTaskId === parent.id);
      if (siblings.every((s) => s.status === 'dealt')) {
        const anyReject = siblings.some((s) => s.dealtAction === 'sign-reject');
        this.engineBackToPending(parent);
        const holders = parent.assignee ? [parent.assignee] : parent.candidates;
        this.notify(holders, anyReject ? '加签存在不同意意见' : '加签已完成',
          anyReject ? `任务「${parent.nodeName}」的加签人中有人不同意，请谨慎处理` : `任务「${parent.nodeName}」的加签人已全部处理，请继续处理`,
          parent.instanceId, parent.id);
      }
      this.stampSealsSince(logWatermark, actor.uid);
      bus.emitEvent({ type: 'TaskDealt', instanceId: task.instanceId, taskId: task.id, nodeId: task.nodeId, action: 'sign', actorUid: actor.uid, actorName: actor.name });
      return { instance: this.mustInstance(task.instanceId), task: this.tasks.find((t) => t.id === task.id)! };
    }

    const instance = this.mustInstance(task.instanceId);
    const flow = this.flowOf(instance);
    const node = this.nodeOf(flow, task.nodeId);
    const actionSpec = (node.actions ?? []).find((a) => a.code === input.operation.code);
    if (!actionSpec) throw new Error(`节点「${node.name}」不允许操作: ${input.operation.code}`);
    const fieldErrs = this.checkDealInput(input, actionSpec);
    if (fieldErrs) throw fieldErrs;

    // 审批人表单修改（仅 writable 字段生效）
    if (input.data && Object.keys(input.data).length) {
      const schema = { components: this.formOf(instance).components };
      const merged = { ...instance.data, ...input.data };
      const errs = formEngine.validate(schema, merged, node.auths?.[String(instance.formVersionId)] ?? {}, { data: merged, actor });
      if (errs.length) throw Object.assign(new Error('表单校验失败'), { fieldErrors: errs });
      this.instances.update((i) => i.id === instance.id, { data: merged });
      instance.data = merged;
    }

    const dealMode = node.assignee?.dealMode ?? 'or';
    // 审批人指定了下一环节审批人：先暂存到实例（若下一节点非"发起人指定"节点，则跨节点消费）
    if (input.next?.assignees?.length) {
      instance.pendingChoice = input.next.assignees;
      this.instances.update((i) => i.id === instance.id, { pendingChoice: input.next.assignees });
    }
    const rt = instance.currentNodes.find((n) => n.taskIds.includes(task.id));
    const prevTask = { ...task };
    try {
      this.tasks.update((t) => t.id === task.id, { status: 'dealt', dealtAt: now(), dealtBy: actor.uid, dealtAction: input.operation.code });

      if (dealMode === 'all' && rt) {
      // 会签：写个人意见日志；全票处理完才推进
      this.writeLog({
        instanceId: instance.id, taskId: task.id, nodeId: node.id, nodeName: node.name,
        actorUid: actor.uid, actorName: actor.name,
        action: (node.actions ?? []).find((a) => a.code === input.operation.code)?.name ?? input.operation.code,
        comment: input.comment ?? '', attachments: input.attachments ?? [], snapshot: { deal: input as unknown as Json },
      });
      const siblings = this.tasks.filter((t) => rt.taskIds.includes(t.id));
      if (!siblings.every((s) => s.status === 'dealt')) {
        // 会签未齐：本次先处理到这里
        this.stampSealsSince(logWatermark, actor.uid);
        bus.emitEvent({ type: 'TaskDealt', instanceId: instance.id, taskId: task.id, nodeId: node.id, action: input.operation.code, actorUid: actor.uid, actorName: actor.name });
        return { instance, task: this.tasks.find((t) => t.id === task.id)! };
      }
      const rejects = siblings.filter((s) => s.dealtAction !== 'approve');
      const combined: DealInput = {
        comment: siblings.map((s) => `${this.principalOf(s.dealtBy!).name}:${s.dealtAction}`).join('；') + (input.comment ? `｜${input.comment}` : ''),
        attachments: input.attachments ?? [], reader: input.reader ?? [],
        operation: rejects.length ? { code: 'reject' } : { code: 'approve' },
      };
      if (rejects.length) {
        const spec = (node.actions ?? []).find((a) => a.code === 'reject');
        this.rejectTo(instance, node, spec?.backTo ?? 'start', actor, combined);
      } else {
        this.routeFrom(instance, node.id, actor, combined);
      }
    } else {
      // or 模式：直接执行动作策略（由策略写日志并推进）
      actionRegistry.get(input.operation.code).execute({
        instance, task: this.tasks.find((t) => t.id === task.id)!, node, actionSpec, input, actor,
        engine: {
          writeLog: (l) => this.writeLog(l),
          routeFrom: (inst, from, act, inp) => this.routeFrom(inst, from, act, inp),
          rejectTo: (inst, nd, backTo, act, inp) => this.rejectTo(inst, nd, backTo, act, inp),
          spawnSignTasks: (parent, uids) => this.spawnSignTasks(parent, uids),
          backToPending: (t) => this.engineBackToPending(t),
          notify: (uids, title, body, iid, tid) => this.notify(uids, title, body, iid, tid),
          findUser: (u) => this.findUser(u),
        },
      });
    }
    } catch (e) {
      // 推进失败（如未指定审批人）：还原任务状态，让处理人可以补充后重试
      this.tasks.update((t) => t.id === task.id, {
        status: prevTask.status, dealtAt: prevTask.dealtAt, dealtBy: prevTask.dealtBy, dealtAction: prevTask.dealtAction,
      });
      throw e;
    }

    if (input.reader?.length) {
      this.notify(input.reader, '知会通知', `${actor.name} 在「${instance.appSnapshot.name}」中知会了您${input.comment ? '：' + input.comment : ''}`, instance.id, undefined, 'read');
      this.writeLog({
        instanceId: instance.id, taskId: task.id, nodeId: node.id, nodeName: node.name,
        actorUid: actor.uid, actorName: actor.name, action: '知会',
        comment: input.reader.map((u) => this.findUser(u)?.name ?? u).join('、'),
        attachments: [], snapshot: { reader: input.reader },
      });
    }
    this.stampSealsSince(logWatermark, actor.uid);
    bus.emitEvent({ type: 'TaskDealt', instanceId: instance.id, taskId: task.id, nodeId: node.id, action: input.operation.code, actorUid: actor.uid, actorName: actor.name });
    return { instance: this.mustInstance(instance.id), task: this.tasks.find((t) => t.id === task.id)! };
  }

  // 对本次 deal 产生的审批日志加盖处理人个人签章（防抵赖）
  private stampSealsSince(watermark: number, actorUid: number) {
    const stampable = this.logs
      .filter((l) => l.id > watermark && l.actorUid === actorUid && !['知会', '催办'].includes(l.action));
    for (const log of stampable) this.stampLog(log);
  }

  // 给单条审批日志盖章（幂等：已有签章则跳过）
  stampLog(log: ApprovalLog) {
    try {
      const content = JSON.stringify({
        instanceId: log.instanceId, taskId: log.taskId, nodeId: log.nodeId, nodeName: log.nodeName,
        action: log.action, comment: log.comment, attachments: log.attachments, createdAt: log.createdAt,
      });
      const u = this.users.all().find((x) => x.id === log.actorUid);
      if (!u) return;
      if (!getSealInfo(log.actorUid)) ensureSeal(u.name, u.number, log.actorUid);
      const seal = signWithSeal(log.actorUid, content);
      if (seal) {
        this.logs.update((l) => l.id === log.id, { snapshot: { ...(log.snapshot ?? {}), seal: seal as unknown as Json } as Json });
      }
    } catch (err) {
      console.error('[seal] 盖章失败（不影响审批）:', (err as Error).message);
    }
  }

  // 补签：为实例中缺签章的审批日志补盖签章（导出 PDF 前调用）
  ensureInstanceSeals(instanceId: number) {
    const unstamped = this.logs.filter((l) => l.instanceId === instanceId && !(l.snapshot as any)?.seal && !['知会', '催办'].includes(l.action));
    for (const log of unstamped) this.stampLog(log);
  }

  private checkDealInput(input: DealInput, actionSpec: { opinionRequired?: boolean; attachmentRequired?: boolean } | null): Error | null {
    if (actionSpec?.opinionRequired && !input.comment?.trim()) return new Error('请填写审批意见');
    if (actionSpec?.attachmentRequired && !(input.attachments?.length)) return new Error('请上传附件');
    return null;
  }

  rejectTo(instance: Instance, node: FlowNode, backTo: string, actor: Principal, input: DealInput) {
    // 取消全部待办 + 关闭当前节点
    for (const rt of instance.currentNodes.slice()) {
      for (const tid of rt.taskIds) {
        this.tasks.update((t) => t.id === tid && t.status !== 'dealt', { status: 'cancelled', dealtAt: now() });
      }
      instance.history.push({ nodeId: rt.nodeId, taskIds: rt.taskIds });
    }
    instance.currentNodes = [];
    this.instances.update((i) => i.id === instance.id, { currentNodes: [], history: instance.history });
    if (backTo === 'start') {
      const start = this.flowOf(instance).nodes.find((n) => n.kind === 'start')!;
      const t = this.tasks.insert({
        id: 0, instanceId: instance.id, nodeId: start.id, nodeName: '退回修改',
        assignee: instance.createdBy, candidates: [instance.createdBy], status: 'pending', createdAt: now(),
      });
      instance.currentNodes.push({ nodeId: 'start', taskIds: [t.id], enteredAt: now() });
      this.instances.update((i) => i.id === instance.id, { currentNodes: instance.currentNodes, status: 'running' });
      this.notify([instance.createdBy], '您的申请被退回', `${actor.name} 退回了「${instance.appSnapshot.name}」${input.comment ? '：' + input.comment : ''}，请修改后重新提交`, instance.id, t.id);
      bus.emitEvent({ type: 'TaskCreated', instanceId: instance.id, taskId: t.id, nodeId: 'start', nodeName: '退回修改', assignee: instance.createdBy, candidates: [instance.createdBy] });
    } else if (backTo === 'end') {
      this.finish(instance, 'rejected');
    } else {
      this.instances.update((i) => i.id === instance.id, { status: 'running' });
      this.openNode(instance, backTo);
    }
  }

  // ===== 审批人自我修正 =====
  // 审批人修改自己已提交的结论（仅限本人；后续审批未进行时才可改）
  correctResult(actor: Principal, instanceId: number, input: { nodeId: string; result: 'approve' | 'reject'; comment?: string }): Instance {
    const inst = this.mustInstance(instanceId);
    if (inst.status !== 'running') throw new Error('实例当前状态不可修正');
    const flow = this.flowOf(inst);
    const idxOf = (id: string) => flow.nodes.findIndex((n) => n.id === id);
    const target = this.nodeOf(flow, input.nodeId);
    if (target.kind !== 'userTask') throw new Error('只能修正审批节点的结果');

    // 目标节点必须已产生过结论，且是本人给出的
    const last = this.tasks
      .filter((t) => t.instanceId === inst.id && t.nodeId === target.id && t.status === 'dealt' && Boolean(t.dealtAction))
      .sort((a, b) => b.id - a.id)[0];
    if (!last) throw new Error('该节点尚无已产生的审批结果');
    if (last.dealtBy !== actor.uid) throw new Error('只能修正自己给出的审批结果');

    // 后续审批必须尚未进行：更靠后的节点只要有"已打开（claimed）"或"已处理"的任务即锁定
    const laterLocked = this.tasks.filter((t) => t.instanceId === inst.id && t.nodeId !== 'start'
      && idxOf(t.nodeId) > idxOf(target.id) && (t.status === 'dealt' || t.status === 'claimed'));
    if (laterLocked.length) throw new Error('后续审批人已打开或已处理，无法修正');

    const prevApprove = !['reject', 'force-reject', 'sign-reject', 'correct-reject'].includes(last.dealtAction!);
    const newApprove = input.result === 'approve';
    if (prevApprove === newApprove) throw new Error('审批结果未变化，无需修正');

    const actionName = newApprove ? '审批修正（改判通过）' : '审批修正（改判退回）';
    this.writeLog({
      instanceId: inst.id, taskId: last.id, nodeId: target.id, nodeName: target.name,
      actorUid: actor.uid, actorName: actor.name, action: actionName,
      comment: input.comment ?? '', attachments: [],
      snapshot: { correctedTaskId: last.id, previous: last.dealtAction as unknown as Json, result: input.result },
    });

    if (!newApprove) {
      // 改判退回：原"同意"作废，退回发起人修改重报
      this.tasks.update((t) => t.id === last.id, { dealtAction: 'correct-reject' });
      this.rejectTo(inst, target, 'start', actor, { operation: { code: 'reject' }, comment: input.comment ?? '' });
    } else {
      // 改判通过：撤销发起人的重报待办，从该节点按"通过"重新路由
      this.tasks.update((t) => t.id === last.id, { dealtAction: 'correct-approve' });
      const kept = inst.currentNodes.filter((rt) => this.nodeOf(flow, rt.nodeId).kind !== 'start');
      for (const rt of inst.currentNodes) {
        if (!kept.includes(rt)) {
          for (const tid of rt.taskIds) this.tasks.update((t) => t.id === tid && t.status !== 'dealt', { status: 'cancelled', dealtAt: now() });
          inst.history.push({ nodeId: rt.nodeId, taskIds: rt.taskIds });
        }
      }
      inst.currentNodes = kept;
      this.instances.update((i) => i.id === inst.id, { currentNodes: kept, history: inst.history, status: 'running' });
      this.routeFrom(inst, target.id, actor, { operation: { code: 'approve' }, comment: input.comment ?? '' });
    }
    return this.mustInstance(inst.id);
  }

  // 强制审批：对当前节点全部待办强行通过/退回（仅 allowForce=true 的节点开放）
  forceDeal(actor: Principal, instanceId: number, input: { action: 'approve' | 'reject'; comment?: string }): Instance {
    if (!actor.roles.includes('admin')) throw new Error('仅管理员可强制审批');
    const inst = this.mustInstance(instanceId);
    if (inst.status !== 'running') throw new Error('实例当前状态不可强制审批');
    const flow = this.flowOf(inst);

    const pendings = this.tasks.filter((t) => t.instanceId === inst.id && ['pending', 'claimed'].includes(t.status));
    if (!pendings.length) throw new Error('当前没有可强制处理的待办任务');
    for (const t of pendings) {
      const node = this.nodeOf(flow, t.nodeId);
      if (!node.allowForce) throw new Error(`节点「${node.name}」未开放强制审批权限`);
    }

    const byNode = new Map<string, Task[]>();
    for (const t of pendings) {
      const list = byNode.get(t.nodeId) ?? [];
      list.push(t);
      byNode.set(t.nodeId, list);
    }
    const actionName = input.action === 'approve' ? '强制通过（管理员）' : '强制退回（管理员）';
    for (const [nodeId, tasks] of byNode) {
      const node = this.nodeOf(flow, nodeId);
      for (const t of tasks) {
        this.tasks.update((x) => x.id === t.id, { status: 'dealt', dealtAt: now(), dealtBy: actor.uid, dealtAction: 'force-' + input.action });
      }
      this.writeLog({
        instanceId: inst.id, taskId: tasks[0]?.id ?? null, nodeId, nodeName: node.name,
        actorUid: actor.uid, actorName: actor.name, action: actionName,
        comment: input.comment ?? '', attachments: [], snapshot: { forcedTaskIds: tasks.map((t) => t.id) },
      });
    }

    if (input.action === 'approve') {
      for (const nodeId of byNode.keys()) {
        this.routeFrom(inst, nodeId, actor, { operation: { code: 'approve' } });
      }
    } else {
      // 强制退回 = 终结流程
      for (const rt of inst.currentNodes.slice()) {
        inst.history.push({ nodeId: rt.nodeId, taskIds: rt.taskIds });
      }
      inst.currentNodes = [];
      this.instances.update((i) => i.id === inst.id, { currentNodes: [], history: inst.history });
      this.finish(inst, 'rejected');
    }
    bus.emitEvent({ type: 'InstanceFinished', instanceId: inst.id, appId: inst.appId, status: input.action === 'approve' ? 'forced-approve' : 'rejected' });
    return this.mustInstance(inst.id);
  }

  changeApprover(actor: Principal, instanceId: number, mapping: Record<string, number[]>) {
    const inst = this.mustInstance(instanceId);
    for (const [nodeId, uids] of Object.entries(mapping)) {
      const rt = inst.currentNodes.find((n) => n.nodeId === nodeId);
      if (!rt) throw new Error(`节点 ${nodeId} 不在当前待办中`);
      for (const tid of rt.taskIds) {
        this.tasks.update((t) => t.id === tid && t.status === 'pending', { assignee: null, candidates: uids });
      }
      this.writeLog({
        instanceId, taskId: rt.taskIds[0] ?? null, nodeId,
        nodeName: this.nodeOf(this.flowOf(inst), nodeId).name,
        actorUid: actor.uid, actorName: actor.name, action: '更换审批人',
        comment: uids.map((u) => this.findUser(u)?.name ?? u).join('、'), attachments: [], snapshot: { mapping },
      });
      this.notify(uids, '您有新的待办任务', `事项「${inst.appSnapshot.name}」已转给您审批`, instanceId, rt.taskIds[0]);
    }
  }

  urge(actor: Principal, taskId: number) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('任务不存在');
    const inst = this.mustInstance(task.instanceId);
    const uids = task.assignee ? [task.assignee] : task.candidates;
    this.notify(uids, '催办提醒', `${actor.name} 催促您处理「${inst.appSnapshot.name}」的任务「${task.nodeName}」`, inst.id, task.id);
    this.writeLog({
      instanceId: inst.id, taskId: task.id, nodeId: task.nodeId, nodeName: task.nodeName,
      actorUid: actor.uid, actorName: actor.name, action: '催办', comment: '', attachments: [], snapshot: {},
    });
  }

  revoke(actor: Principal, instanceId: number) {
    const inst = this.mustInstance(instanceId);
    if (inst.createdBy !== actor.uid && !actor.roles.includes('admin')) throw new Error('无权撤销');
    if (inst.status !== 'running') throw new Error('当前状态不可撤销');
    for (const rt of inst.currentNodes) {
      this.tasks.update((t) => rt.taskIds.includes(t.id) && t.status !== 'dealt', { status: 'cancelled', dealtAt: now() });
    }
    this.instances.update((i) => i.id === instanceId, { status: 'revoked', currentNodes: [], finishedAt: now() });
    this.writeLog({
      instanceId, taskId: null, nodeId: '-', nodeName: '-',
      actorUid: actor.uid, actorName: actor.name, action: '撤销', comment: '', attachments: [], snapshot: {},
    });
    bus.emitEvent({ type: 'InstanceRevoked', instanceId, byUid: actor.uid });
    bus.emitEvent({ type: 'InstanceFinished', instanceId, appId: inst.appId, status: 'revoked' });
  }

  // ===== 加签底层 =====
  spawnSignTasks(parent: Task, uids: number[]): Task[] {
    const out: Task[] = [];
    for (const uid of uids) {
      const t = this.tasks.insert({
        id: 0, instanceId: parent.instanceId, nodeId: parent.nodeId, nodeName: parent.nodeName,
        assignee: uid, candidates: [uid], status: 'pending', parentTaskId: parent.id, createdAt: now(),
      });
      out.push(t);
      bus.emitEvent({ type: 'TaskCreated', instanceId: parent.instanceId, taskId: t.id, nodeId: parent.nodeId, nodeName: parent.nodeName, assignee: uid, candidates: [uid], parentTaskId: parent.id });
      this.notify([uid], '您有加签任务待处理', `请先于原审批人处理「${parent.nodeName}」`, parent.instanceId, t.id);
    }
    return out;
  }
  private engineBackToPending(task: Task) {
    this.tasks.update((t) => t.id === task.id, { status: 'pending' });
  }

  // ===== 查询辅助 =====
  todoOf(uid: number): Task[] {
    return this.tasks
      .filter((t) => ['pending', 'claimed'].includes(t.status) && (t.assignee === uid || t.candidates.includes(uid)))
      .sort((a, b) => b.id - a.id);
  }
  dealtLogsOf(uid: number): ApprovalLog[] {
    // 已办 = 本人处理过的任务对应的日志（动作名是节点上自定义的，如"审核通过"，不能按名字过滤）
    const taskIds = new Set(this.tasks.filter((t) => t.dealtBy === uid && t.status === 'dealt').map((t) => t.id));
    return this.logs
      .filter((l) => l.taskId !== null && taskIds.has(l.taskId) && !['知会', '催办'].includes(l.action))
      .sort((a, b) => b.id - a.id);
  }
  instancesOf(uid: number): Instance[] {
    return this.instances.filter((i) => i.createdBy === uid).sort((a, b) => b.id - a.id);
  }
  variablesOf(instance: Instance): Record<string, { key: string; name: string; value: JsonValue }> {
    const u = this.principalOf(instance.createdBy);
    const flow = this.flowOf(instance);
    const nodeIds = instance.currentNodes.map((n) => n.nodeId);
    const nodeNames = instance.currentNodes.map((n) => this.nodeOf(flow, n.nodeId).name);
    const base: Json = {
      user_id: u.uid, user_name: u.name, user_number: u.number, user_department: u.department,
      app_id: instance.appId, app_name: instance.appSnapshot.name,
      node_id: nodeIds, node_name: nodeNames, ...instance.vars,
    };
    const defs = Object.fromEntries(flow.variables.map((v) => [v.key, v.name]));
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { key: k, name: defs[k] ?? k, value: v as JsonValue }]));
  }

  // ===== 内部 =====
  private finish(instance: Instance, status: 'finished' | 'rejected') {
    this.instances.update((i) => i.id === instance.id, { status, finishedAt: now(), progress: 100 });
    bus.emitEvent({ type: 'InstanceFinished', instanceId: instance.id, appId: instance.appId, status });
  }
  private setVars(instance: Instance, patch: Json) {
    this.instances.update((i) => i.id === instance.id, { vars: { ...instance.vars, ...patch } });
    instance.vars = { ...instance.vars, ...patch };
  }
  private recomputeProgress(inst: Instance) {
    const flow = this.flowOf(inst);
    const userNodes = flow.nodes.filter((n) => n.kind === 'userTask');
    const done = new Set(inst.history.map((h) => h.nodeId));
    const pct = Math.min(99, Math.round((done.size / Math.max(1, userNodes.length)) * 100));
    inst.progress = pct;
    this.instances.update((i) => i.id === inst.id, { progress: pct });
  }
  mustInstance(id: number): Instance {
    const i = this.instances.find((x) => x.id === id);
    if (!i) throw new Error('流程实例不存在');
    return i;
  }
  private exprVars(instance: Instance): Record<string, unknown> {
    const u = this.principalOf(instance.createdBy);
    return { ...instance.vars, user_id: u.uid, user_number: u.number, user_department: u.department, form: instance.data };
  }
}

export function now(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
