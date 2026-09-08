import type { FlowNode, JsonValue, RoutingSpec } from '../../core/types.js';
import { Registry } from '../../core/registry.js';
import { evaluate } from './expr.js';

export interface RouteCtx {
  vars: Record<string, any>;
  form: Record<string, any>;
  fromNodeId: string;
}

export interface IRoutingStrategy {
  readonly kind: string;
  next(spec: RoutingSpec, ctx: RouteCtx, nodes: FlowNode[]): string[]; // 返回目标节点 id（可多个=并行）
}

export class RoutingRegistry extends Registry<IRoutingStrategy> {}

export const routingRegistry = new RoutingRegistry();

routingRegistry.register({
  kind: 'sequential',
  next(spec) { return [spec.next ?? 'end']; },
});

routingRegistry.register({
  kind: 'conditional',
  next(spec, ctx) {
    for (const b of spec.branches ?? []) {
      if (evaluate(b.when, { vars: ctx.vars, form: ctx.form })) return [b.to];
    }
    return [spec.fallback ?? 'end'];
  },
});

routingRegistry.register({
  kind: 'parallel',
  next(spec) { return spec.to ?? ['end']; },
});
