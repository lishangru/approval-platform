import type { ComponentDef, FieldError, JsonValue, ValidateCtx } from '../../core/types.js';

// 组件策略接口 —— 新增组件类型 = 实现一个类并 register，引擎零改动
export interface IComponent {
  readonly type: string;
  normalize(raw: JsonValue, def: ComponentDef, ctx: ValidateCtx): JsonValue;
  validate(value: JsonValue, def: ComponentDef, ctx: ValidateCtx): FieldError[];
  isEmpty(v: JsonValue): boolean;
}

export class ComponentRegistry {
  private map = new Map<string, IComponent>();
  register(c: IComponent, opts: { override?: boolean } = {}) {
    if (this.map.has(c.type) && !opts.override) throw new Error(`组件 "${c.type}" 已注册`);
    this.map.set(c.type, c);
  }
  get(type: string): IComponent {
    // 未注册的类型 fallback 为通用文本处理，保证老版本快照数据永远可读
    return this.map.get(type) ?? this.map.get('input')!;
  }
  all(): IComponent[] { return [...this.map.values()]; }
}
