import type { AssigneeSpec, Expr, ExprCtx, Principal } from '../../core/types.js';
import { Registry } from '../../core/registry.js';
import { evaluate } from './expr.js';

// 审批人解析策略 —— ResolveCtx 由引擎构造（含发起人、候选人选择、变量、表单数据）
export interface AssigneeCtx {
  initiator: Principal;
  chosen?: number[];            // 发起人指定的下一节点审批人（initiator_choose）
  vars: Json2;
  form: Json2;
  findUser: (uid: number) => Principal | undefined;
  findRoleUsers: (role: string, opts?: { departmentId?: number }) => Principal[];
}
type Json2 = Record<string, unknown>;

export interface IAssigneeResolver {
  readonly kind: string;
  resolve(spec: AssigneeSpec, ctx: AssigneeCtx): Principal[];
}

export class AssigneeRegistry extends Registry<IAssigneeResolver> {}

export const assigneeRegistry = new AssigneeRegistry();

assigneeRegistry.register({
  kind: 'fixed',
  resolve(spec, ctx) {
    const uids = (Array.isArray(spec.value) ? spec.value : [spec.value]).map(Number).filter(Boolean);
    return uids.map((u) => ctx.findUser(u)).filter(Boolean) as Principal[];
  },
});

assigneeRegistry.register({
  kind: 'initiator',
  resolve(_spec, ctx) { return [ctx.initiator]; },
});

// 发起人所在部门的主管（部门内具有 leader 角色的人）
assigneeRegistry.register({
  kind: 'dept_leader',
  resolve(_spec, ctx) {
    return ctx.findRoleUsers('leader', { departmentId: ctx.initiator.departmentId });
  },
});

assigneeRegistry.register({
  kind: 'role',
  resolve(spec, ctx) {
    const role = String(spec.value ?? '');
    const users = ctx.findRoleUsers(role);
    if (!users.length) throw new Error(`角色 "${role}" 下没有可用审批人`);
    return users;
  },
});

// 发起人提交时手动指定（对应 ehall setNextExamInfo），可配候选人范围 scope
assigneeRegistry.register({
  kind: 'initiator_choose',
  resolve(spec, ctx) {
    const uids = (ctx.chosen ?? []).map(Number);
    if (!uids.length) throw new Error('需要指定本节点的审批人');
    const people = uids.map((u) => ctx.findUser(u)).filter(Boolean) as Principal[];
    // 范围外的人静默过滤；全部不合法时返回空，由引擎给出可操作的提示
    return people.filter((p) => inScope({ id: p.uid, roles: p.roles, group: p.group, departmentId: p.departmentId }, spec.scope));
  },
});

// ===== 候选人范围过滤（发起人指定 / 选人接口共用）=====
export interface ScopeSpec { kind: 'all' | 'role' | 'group' | 'department' | 'fixed'; value?: any }

export function inScope(u: { id: number; roles: string[]; group?: string; departmentId: number }, scope?: ScopeSpec): boolean {
  if (!scope || !scope.kind || scope.kind === 'all') return true;
  switch (scope.kind) {
    case 'role': return u.roles.includes(String(scope.value));
    case 'group': return u.group === String(scope.value);
    case 'department': return u.departmentId === Number(scope.value);
    case 'fixed': return ((Array.isArray(scope.value) ? scope.value : [scope.value]).map(Number) as number[]).includes(u.id);
    default: return true;
  }
}

// 用户组：spec.value = 组名（如"学工处-审核组"）
assigneeRegistry.register({
  kind: 'group',
  resolve(spec, ctx) {
    const groupName = String(spec.value ?? '');
    const users = ctx.findRoleUsers('*').filter((u) => u.group === groupName);
    if (!users.length) throw new Error(`用户组「${groupName}」下没有成员`);
    return users;
  },
});

// 逃生舱：表达式选人（如按变量/表单值过滤）
assigneeRegistry.register({
  kind: 'expr',
  resolve(spec, ctx) {
    const all = ctx.findRoleUsers('*');
    const rule = spec.value as unknown as { filter: Expr; department?: string };
    return all.filter((u) => {
      const c: ExprCtx = { vars: ctx.vars as any, form: ctx.form as any };
      const dep = rule.department ? String(evaluate(rule.department, c)) === u.department : true;
      return dep && Boolean(evaluate(rule.filter, { vars: ctx.vars as any, form: ctx.form as any, actor: u }));
    });
  },
});
