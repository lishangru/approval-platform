import type { ComponentDef, FieldError, Json, JsonValue, ValidateCtx } from '../../core/types.js';
import { ComponentRegistry, type IComponent } from './registry.js';
import { evaluate } from '../flow/expr.js';

const err = (def: ComponentDef, message: string): FieldError => ({ key: def.key, label: def.label, message });

// ===== 内置组件实现（按 ehall 逆向的组件类型命名）=====
class Input implements IComponent {
  type = 'input';
  normalize(raw: JsonValue) { return raw === null || raw === undefined ? '' : String(raw).trim(); }
  isEmpty(v: JsonValue) { return v === null || v === undefined || v === ''; }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    const out: FieldError[] = [];
    const p = def.props ?? {};
    if (typeof v === 'string' && p.maxLength && v.length > Number(p.maxLength)) out.push(err(def, `不能超过 ${p.maxLength} 个字符`));
    if (typeof v === 'string' && p.regex && !new RegExp(String(p.regex)).test(v)) out.push(err(def, String(p.message ?? '格式不正确')));
    return out;
  }
}

class Textarea extends Input { type = 'textarea'; }

class Integer implements IComponent {
  type = 'integer';
  normalize(raw: JsonValue) { if (raw === null || raw === undefined || raw === '') return null; const n = Number(raw); return Number.isFinite(n) ? Math.trunc(n) : null; }
  isEmpty(v: JsonValue) { return v === null || v === undefined; }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    const out: FieldError[] = [];
    const n = Number(v);
    const p = def.props ?? {};
    if (!Number.isFinite(n) || !Number.isInteger(Number(v))) out.push(err(def, '必须为整数'));
    else {
      if (p.min !== undefined && n < Number(p.min)) out.push(err(def, `不能小于 ${p.min}`));
      if (p.max !== undefined && n > Number(p.max)) out.push(err(def, `不能大于 ${p.max}`));
    }
    return out;
  }
}

class Float extends Integer { type = 'float'; }

class Calendar implements IComponent {
  type = 'calendar';
  normalize(raw: JsonValue) { return raw === null || raw === undefined ? '' : String(raw); }
  isEmpty(v: JsonValue) { return v === null || v === undefined || v === ''; }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    const out: FieldError[] = [];
    if (typeof v === 'string' && v !== '' && Number.isNaN(Date.parse(v))) out.push(err(def, '日期格式不正确'));
    return out;
  }
}

class OptionsComponent implements IComponent {
  type = 'radio';
  normalize(raw: JsonValue) { return raw ?? null; }
  isEmpty(v: JsonValue) { return v === null || v === undefined || v === ''; }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    const opts: JsonValue[] = (def.props?.options as JsonValue[]) ?? [];
    const values = opts.map((o) => (typeof o === 'object' && o !== null ? (o as Json).value : o));
    if (!values.map(String).includes(String(v))) return [err(def, '所选值不在选项内')];
    return [];
  }
}

class Select extends OptionsComponent { type = 'select'; }

class MultiInput implements IComponent {
  type = 'multiInput';
  normalize(raw: JsonValue) { return Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []; }
  isEmpty(v: JsonValue) { return !Array.isArray(v) || v.length === 0; }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    if (!Array.isArray(v)) return [err(def, '必须是数组')];
    const max = Number(def.props?.maxCount ?? 0);
    if (max && v.length > max) return [err(def, `最多 ${max} 项`)];
    return [];
  }
}

// 选人组件：值为 {uid,name} 或 {uid,name}[]（multiple）
class UserPicker implements IComponent {
  type = 'userPicker';
  normalize(raw: JsonValue): JsonValue { return raw; }
  isEmpty(v: JsonValue) { return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0); }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    const items = Array.isArray(v) ? v : [v];
    for (const it of items) {
      if (!it || typeof (it as Json).uid !== 'number') return [err(def, '请选择人员')];
    }
    return [];
  }
}

class FilePicker implements IComponent {
  type = 'file';
  normalize(raw: JsonValue) { return Array.isArray(raw) ? raw : raw ? [raw] : []; }
  isEmpty(v: JsonValue) { return !Array.isArray(v) || v.length === 0; }
  validate(v: JsonValue, def: ComponentDef): FieldError[] {
    const max = Number(def.props?.maxCount ?? 0);
    if (Array.isArray(v) && max && v.length > max) return [err(def, `最多上传 ${max} 个文件`)];
    return [];
  }
}

// ===== 注册表实例 =====
export const components = new ComponentRegistry();
components.register(new Input());
components.register(new Textarea());
components.register(new Integer());
components.register(new Float());
components.register(new Calendar());
components.register(new OptionsComponent());
components.register(new Select());
components.register(new MultiInput());
components.register(new UserPicker());
components.register(new FilePicker());

// ===== 表单引擎（纯函数域服务）=====
export interface AuthMatrix { [componentKey: string]: string }  // key -> FieldAuth

export class FormEngine {
  constructor(private registry: ComponentRegistry) {}

  normalize(schema: { components: ComponentDef[] }, data: Json, ctx: ValidateCtx): Json {
    const out: Json = {};
    for (const def of schema.components) {
      if (!this.visible(def, data, ctx)) { out[def.key] = null; continue; }
      out[def.key] = this.registry.get(def.type).normalize(data?.[def.key] ?? null, def, ctx);
    }
    return out;
  }

  // 核心校验：权限矩阵驱动（forbidden忽略 / require必填 / writable+visible 校验规则）
  // defaultAuth：矩阵未配置字段时的默认权限（发起节点=writable，审批节点=readable）
  validate(schema: { components: ComponentDef[] }, data: Json, auth: AuthMatrix, ctx: ValidateCtx = { data }, defaultAuth = 'readable'): FieldError[] {
    const errors: FieldError[] = [];
    for (const def of schema.components) {
      let a = auth[def.key] ?? defaultAuth;
      if (a === 'forbidden' || !this.visible(def, data, ctx)) continue;
      // 设计器里配置的"必填"（组件级）优先于节点矩阵
      const isRequire = a === 'require' || (def.props?.required === true && a !== 'front_readonly');
      if (isRequire) a = 'require';
      const value = data?.[def.key] ?? null;
      const comp = this.registry.get(def.type);
      if (a === 'require' && comp.isEmpty(value)) { errors.push(err(def, '此项为必填项')); continue; }
      if ((a === 'writable' || a === 'require') && !comp.isEmpty(value)) errors.push(...comp.validate(value, def, ctx));
    }
    return errors;
  }

  // 供前端渲染：给每个字段附加生效权限与可见性
  applyAuth(schema: { components: ComponentDef[] }, auth: AuthMatrix, ctx: ValidateCtx = { data: {} }, defaultAuth = 'readable') {
    return schema.components.map((def) => {
      let a = auth[def.key] ?? defaultAuth;
      if (def.props?.required === true && a !== 'forbidden') a = 'require';
      return { ...def, auth: a, visible: this.visible(def, ctx.data ?? {}, ctx) };
    });
  }

  // 变更留痕（对应 ehall getformchange）
  diff(before: Json, after: Json): { key: string; from: JsonValue; to: JsonValue }[] {
    const out: { key: string; from: JsonValue; to: JsonValue }[] = [];
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const k of keys) {
      if (JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)) {
        out.push({ key: k, from: before?.[k] ?? null, to: after?.[k] ?? null });
      }
    }
    return out;
  }

  visible(def: ComponentDef, data: Json, ctx: ValidateCtx): boolean {
    if (!def.visibleIf) return true;
    return Boolean(evaluate(def.visibleIf, { vars: {}, form: data, ...ctx }));
  }
}

export const formEngine = new FormEngine(components);
