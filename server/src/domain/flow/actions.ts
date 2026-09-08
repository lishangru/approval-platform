import type { ActionSpec, ApprovalLog, FlowNode, Instance, Json, JsonValue, Principal, Task } from '../../core/types.js';
import { Registry } from '../../core/registry.js';

// ===== 审批动作策略（ehall 操作码的泛化：approve/reject/delegate/addSign + 自定义）=====
export interface DealInput {
  comment?: string;
  attachments?: JsonValue[];
  reader?: number[];                       // 知会
  operation: { code: string; name?: string; param?: Json };
  data?: Json;                             // 审批人对表单的修改（writable 字段）
  next?: { assignees?: number[] };         // 为下一节点指定审批人
}

export interface DealCtx {
  instance: Instance;
  task: Task;
  node: FlowNode;
  actionSpec: ActionSpec;                  // 节点上该动作的配置
  input: DealInput;
  actor: Principal;
  // 引擎能力注入（由 WorkflowEngine 实现）
  engine: {
    writeLog(l: Omit<ApprovalLog, 'id' | 'createdAt'>): ApprovalLog;
    routeFrom(instance: Instance, fromNodeId: string, actor: Principal, input: DealInput): void;
    rejectTo(instance: Instance, node: FlowNode, backTo: string, actor: Principal, input: DealInput): void;
    spawnSignTasks(parent: Task, uids: number[]): Task[];
    backToPending(task: Task): void;
    notify(uids: number[], title: string, body: string, instanceId: number, taskId?: number): void;
    findUser(uid: number): Principal | undefined;
  };
}

export interface IActionHandler {
  readonly code: string;
  execute(ctx: DealCtx): void;
}

export class ActionRegistry extends Registry<IActionHandler> {}

export const actionRegistry = new ActionRegistry();

// —— 同意/通过：按节点路由推进 ——
actionRegistry.register({
  code: 'approve',
  execute(ctx) {
    ctx.engine.writeLog({
      instanceId: ctx.instance.id, taskId: ctx.task.id, nodeId: ctx.node.id, nodeName: ctx.node.name,
      actorUid: ctx.actor.uid, actorName: ctx.actor.name,
      action: ctx.actionSpec.name || '同意', comment: ctx.input.comment ?? '',
      attachments: ctx.input.attachments ?? [],
      snapshot: { deal: ctx.input as unknown as Json, formDataAt: ctx.instance.data },
    });
    ctx.engine.routeFrom(ctx.instance, ctx.node.id, ctx.actor, ctx.input);
  },
});

// —— 退回/拒绝：backTo 指定去向（'start'=退回发起人 / 节点id / 'end'=终止）——
actionRegistry.register({
  code: 'reject',
  execute(ctx) {
    ctx.engine.writeLog({
      instanceId: ctx.instance.id, taskId: ctx.task.id, nodeId: ctx.node.id, nodeName: ctx.node.name,
      actorUid: ctx.actor.uid, actorName: ctx.actor.name,
      action: ctx.actionSpec.name || '退回', comment: ctx.input.comment ?? '',
      attachments: ctx.input.attachments ?? [],
      snapshot: { deal: ctx.input as unknown as Json },
    });
    const backTo = ctx.actionSpec.backTo ?? 'start';
    ctx.engine.rejectTo(ctx.instance, ctx.node, backTo, ctx.actor, ctx.input);
  },
});

// —— 代处理/转交：把任务转给指定人（任务不推进）——
actionRegistry.register({
  code: 'delegate',
  execute(ctx) {
    const uid = Number(ctx.input.operation.param?.uid ?? 0);
    const target = ctx.engine.findUser(uid);
    if (!target) throw new Error('代处理人不存在');
    ctx.engine.writeLog({
      instanceId: ctx.instance.id, taskId: ctx.task.id, nodeId: ctx.node.id, nodeName: ctx.node.name,
      actorUid: ctx.actor.uid, actorName: ctx.actor.name, action: '转办',
      comment: `${ctx.actor.name} 转办给 ${target.name}${ctx.input.comment ? '：' + ctx.input.comment : ''}`,
      attachments: [], snapshot: { deal: ctx.input as unknown as Json },
    });
    // 记录转办并把任务交回新处理人
    ctx.task.assignee = target.uid;
    ctx.task.candidates = [target.uid];
    ctx.task.status = 'pending';
    ctx.engine.notify([target.uid], '您有新的待办任务', `${ctx.instance.appSnapshot.name}（${ctx.node.name}）已转办给您`, ctx.instance.id, ctx.task.id);
  },
});

// —— 加签：先给被加签人生成子任务，主任务挂起等待 ——
actionRegistry.register({
  code: 'addSign',
  execute(ctx) {
    const uids = ((ctx.input.operation.param?.uids as number[]) ?? []).map(Number).filter(Boolean);
    if (!uids.length) throw new Error('请选择加签人员');
    const children = ctx.engine.spawnSignTasks(ctx.task, uids);
    ctx.task.status = 'waiting-sign';
    ctx.engine.writeLog({
      instanceId: ctx.instance.id, taskId: ctx.task.id, nodeId: ctx.node.id, nodeName: ctx.node.name,
      actorUid: ctx.actor.uid, actorName: ctx.actor.name, action: '加签',
      comment: `加签给：${uids.map((u) => ctx.engine.findUser(u)?.name ?? u).join('、')}`,
      attachments: [], snapshot: { deal: ctx.input as unknown as Json, signTaskIds: children.map((c) => c.id) },
    });
  },
});
