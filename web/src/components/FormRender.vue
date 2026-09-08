<template>
  <el-form label-width="140px" label-position="right">
    <template v-for="c in components" :key="c.key">
      <el-form-item
        v-if="isVisible(c)"
        :label="c.label"
        :required="isRequired(c)"
      >
        <!-- 只读展示 -->
        <template v-if="!editable(c)">
          <span class="ro-value">{{ display(c, data[c.key]) }}</span>
        </template>
        <!-- 可编辑 -->
        <template v-else>
          <el-input
            v-if="c.type === 'input'"
            v-model="data[c.key]"
            :placeholder="c.props?.placeholder || '请输入'"
            :maxlength="Number(c.props?.maxLength || 200)"
            style="max-width: 480px"
          />
          <el-input
            v-else-if="c.type === 'textarea'"
            v-model="data[c.key]"
            type="textarea"
            :rows="3"
            :placeholder="c.props?.placeholder || '请输入'"
            style="max-width: 480px"
          />
          <el-radio-group v-else-if="c.type === 'radio'" v-model="data[c.key]">
            <el-radio v-for="o in opts(c)" :key="String(o.value)" :value="o.value">{{ o.name }}</el-radio>
          </el-radio-group>
          <el-select v-else-if="c.type === 'select'" v-model="data[c.key]" placeholder="请选择" style="width: 240px">
            <el-option v-for="o in opts(c)" :key="String(o.value)" :label="o.name" :value="o.value" />
          </el-select>
          <el-date-picker
            v-else-if="c.type === 'calendar'"
            v-model="data[c.key]"
            :type="c.props?.showTime ? 'datetime' : 'date'"
            :value-format="c.props?.showTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'"
            :placeholder="c.props?.showTime ? '选择日期和时间' : '选择日期'"
          />
          <el-input-number
            v-else-if="c.type === 'integer'"
            v-model="data[c.key]"
            :min="c.props?.min !== undefined ? Number(c.props.min) : undefined"
            :max="c.props?.max !== undefined ? Number(c.props.max) : undefined"
          />
          <div v-else-if="c.type === 'multiInput'" style="width: 480px">
            <div v-for="(it, i) in arrVal(c)" :key="i" style="display: flex; gap: 8px; margin-bottom: 6px">
              <el-input v-model="data[c.key][i]" placeholder="请输入" />
              <el-button type="danger" text @click="data[c.key].splice(i, 1)">删除</el-button>
            </div>
            <el-button size="small" @click="arrVal(c).push('')">+ 添加一项</el-button>
          </div>
          <el-input v-else v-model="data[c.key]" placeholder="暂不支持的组件类型，按文本处理" />
        </template>
      </el-form-item>
    </template>
    <slot />
  </el-form>
</template>

<script setup lang="ts">
const props = defineProps<{
  components: { type: string; key: string; label: string; props: any; visibleIf?: any; auth: string; visible?: boolean }[];
  data: Record<string, any>;
  mode?: 'edit' | 'readonly';
}>();

function isVisible(c: any): boolean {
  if (c.visible === false) return false;
  if (!c.visibleIf) return true;
  return evalExpr(c.visibleIf);
}
function isRequired(c: any): boolean {
  return c.auth === 'require' || c.props?.required === true;
}
function editable(c: any): boolean {
  if (props.mode === 'readonly') return false;
  return c.auth === 'writable' || c.auth === 'require' || c.props?.required === true;
}
function opts(c: any): { name: string; value: string }[] {
  return (c.props?.options ?? []).map((o: any) => (typeof o === 'object' ? o : { name: String(o), value: String(o) }));
}
function arrVal(c: any) {
  if (!Array.isArray(props.data[c.key])) props.data[c.key] = props.data[c.key] ?? [];
  return props.data[c.key];
}
function display(c: any, v: any): string {
  if (v === null || v === undefined || v === '') return '（未填写）';
  if (c.type === 'radio' || c.type === 'select') {
    const o = opts(c).find((x) => String(x.value) === String(v));
    return o ? o.name : String(v);
  }
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// 与后端 expr.ts 同构的轻量求值器（显隐联动）
function evalExpr(expr: any): boolean {
  const [op, argsRaw] = Object.entries(expr)[0] as [string, any];
  const ev = (x: any) => (typeof x === 'object' && x !== null ? evalExpr(x) : x);
  const args = Array.isArray(argsRaw) ? argsRaw.map(ev) : [ev(argsRaw)];
  const pick = (path: string) => {
    if (path.startsWith('form.')) return props.data[path.slice(5)];
    return props.data[path];
  };
  switch (op) {
    case 'var': return pick(String(args[0]));
    case 'eq': case '==': return args[0] == args[1]; // eslint-disable-line eqeqeq
    case 'ne': case '!=': return args[0] != args[1]; // eslint-disable-line eqeqeq
    case 'gt': case '>': return Number(args[0]) > Number(args[1]);
    case 'ge': case '>=': return Number(args[0]) >= Number(args[1]);
    case 'lt': case '<': return Number(args[0]) < Number(args[1]);
    case 'le': case '<=': return Number(args[0]) <= Number(args[1]);
    case 'and': case '&&': return args.every(Boolean);
    case 'or': case '||': return args.some(Boolean);
    case 'not': case '!': return !args[0];
    default: return true;
  }
}
</script>

<style scoped>
.ro-value { color: #303133; font-size: 14px; }
</style>
