import type { Expr, ExprCtx, Json, JsonValue } from '../../core/types.js';

// 极简 JSONLogic 风格表达式求值器（覆盖条件路由/显隐联动）
// 支持: var, eq, ne, gt, ge, lt, le, in, and, or, not, add, sub, mul, div
export function evaluate(expr: JsonValue | undefined, ctx: ExprCtx): JsonValue {
  if (expr === null || expr === undefined) return null;
  if (typeof expr !== 'object' || Array.isArray(expr)) return expr as JsonValue;

  const [opRaw, argsRaw] = Object.entries(expr as Expr)[0];
  const alias: Record<string, string> = { '==': 'eq', '!=': 'ne', '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le', '&&': 'and', '||': 'or', '!': 'not', '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };
  const op = alias[opRaw] ?? opRaw;
  const args = (Array.isArray(argsRaw) ? argsRaw : [argsRaw]).map((a) => evaluate(a as JsonValue, ctx));
  switch (op) {
    case 'var': {
      const path = String(args[0]);
      if (path.startsWith('form.')) return dig(ctx.form, path.slice(5));
      if (path.startsWith('vars.')) return dig(ctx.vars, path.slice(5));
      return dig(ctx.vars, path) ?? dig(ctx.form, path) ?? null; // 裸键先查变量再查表单
    }
    case 'eq': return args[0] === args[1];
    case 'ne': return args[0] !== args[1];
    case 'gt': return Number(args[0]) > Number(args[1]);
    case 'ge': return Number(args[0]) >= Number(args[1]);
    case 'lt': return Number(args[0]) < Number(args[1]);
    case 'le': return Number(args[0]) <= Number(args[1]);
    case 'in': return (args[1] as unknown as JsonValue[])?.includes(args[0]);
    case 'and': return args.every(Boolean);
    case 'or': return args.some(Boolean);
    case 'not': return !args[0];
    case 'add': return args.reduce((a, b) => Number(a) + Number(b), 0);
    case 'sub': return Number(args[0]) - Number(args[1]);
    case 'mul': return args.reduce((a, b) => Number(a) * Number(b), 1);
    case 'div': return Number(args[0]) / Number(args[1]);
    default: throw new Error(`不支持的表达式操作符: ${op}`);
  }
}

function dig(obj: Json, path: string): JsonValue | null {
  let cur: JsonValue = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, JsonValue>)[seg] ?? null;
  }
  return cur;
}
