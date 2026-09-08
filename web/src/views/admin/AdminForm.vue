<template>
  <div class="designer">
    <!-- 顶栏 -->
    <div class="topbar">
      <div class="title">
        表单设计 · 事项 #{{ appId }}
        <el-select v-model="versionId" size="small" style="width: 190px; margin-left: 12px" placeholder="历史版本" @change="loadVersion">
          <el-option v-for="v in versions" :key="v.id" :label="`#${v.id} ${v.version}（${v.status === 'published' ? '已发布' : '草稿'}）`" :value="v.id" />
        </el-select>
      </div>
      <div>
        <el-button size="small" @click="saveDraft">保存草稿</el-button>
        <el-button size="small" type="success" plain @click="publish">发布此版本</el-button>
      </div>
    </div>

    <div class="cols">
      <!-- 左：组件库 -->
      <div class="palette">
        <div class="panel-title">组件库</div>
        <div v-for="g in paletteGroups" :key="g.name" class="palette-group">
          <div class="group-name">{{ g.name }}</div>
          <div class="grid">
            <div v-for="p in g.items" :key="p.type" class="pal-item" draggable="true"
              @dragstart="onPaletteDragStart($event, p)" @click="addComponent(p)">
              <span class="pal-icon">{{ p.icon }}</span>
              <span>{{ p.label }}</span>
            </div>
          </div>
        </div>
        <div class="tip">点击或拖拽组件到中间画布</div>
      </div>

      <!-- 中：画布 -->
      <div class="canvas-wrap">
        <div class="canvas" @dragover.prevent @drop="onCanvasDrop">
          <div v-if="!components.length" class="empty">从左侧拖入组件开始设计</div>
          <template v-for="(c, i) in components" :key="c.key">
            <div v-if="dropIndex === i" class="drop-line" />
            <div class="field-card" :class="{ selected: selectedIdx === i, dragging: dragIdx === i }"
              draggable="true"
              @dragstart="onItemDragStart($event, i)"
              @dragend="dragIdx = -1; dropIndex = -1"
              @dragover.prevent="onItemDragOver(i)"
              @click="selectedIdx = i">
              <div class="field-head">
                <span class="drag-handle">⠿</span>
                <span class="field-label">{{ c.label || '未命名字段' }}</span>
                <el-tag v-if="c.props?.required" size="small" type="danger" effect="plain">必填</el-tag>
                <el-tag v-if="c.visibleIf" size="small" type="warning" effect="plain" class="cond-tag">联动</el-tag>
                <span class="spacer" />
                <el-button size="small" text @click.stop="duplicate(i)">复制</el-button>
                <el-button size="small" text type="danger" @click.stop="removeAt(i)">删除</el-button>
              </div>
              <div class="field-body">
                <!-- 各类型的控件预览 -->
                <el-input v-if="c.type === 'input'" :placeholder="c.props?.placeholder || '请输入'" disabled />
                <el-input v-else-if="c.type === 'textarea'" type="textarea" :rows="2" :placeholder="c.props?.placeholder || '请输入'" disabled />
                <el-input-number v-else-if="c.type === 'integer' || c.type === 'float'" disabled
                  :min="c.props?.min !== undefined ? Number(c.props.min) : undefined"
                  :max="c.props?.max !== undefined ? Number(c.props.max) : undefined" />
                <el-date-picker v-else-if="c.type === 'calendar'" disabled :type="c.props?.showTime ? 'datetime' : 'date'"
                  :placeholder="c.props?.showTime ? '选择日期和时间' : '选择日期'" />
                <el-radio-group v-else-if="c.type === 'radio'" disabled>
                  <el-radio v-for="o in opts(c)" :key="String(o.value)" :value="o.value">{{ o.name }}</el-radio>
                </el-radio-group>
                <el-select v-else-if="c.type === 'select'" disabled :placeholder="c.props?.placeholder || '请选择'" style="width: 220px">
                  <el-option v-for="o in opts(c)" :key="String(o.value)" :label="o.name" :value="o.value" />
                </el-select>
                <div v-else-if="c.type === 'multiInput'" class="multi-preview">
                  <el-input disabled placeholder="选项 1" /><el-input disabled placeholder="选项 2" />
                </div>
                <div v-else-if="c.type === 'userPicker'" class="ghost-box">👤 人员选择控件</div>
                <div v-else-if="c.type === 'file'" class="ghost-box">📎 附件上传控件{{ c.props?.maxCount ? `（最多 ${c.props.maxCount} 个）` : '' }}</div>
                <el-input v-else :placeholder="c.props?.placeholder || '未知类型，按文本处理'" disabled />
              </div>
            </div>
          </template>
          <div v-if="dropIndex === components.length && components.length" class="drop-line" />
          <div v-if="components.length" class="canvas-end">— 表单底部 —</div>
        </div>
      </div>

      <!-- 右：属性面板 -->
      <div class="props">
        <div class="panel-title">属性设置</div>
        <template v-if="sel">
          <el-form label-position="top" size="small">
            <el-form-item label="字段标题"><el-input v-model="sel.label" /></el-form-item>
            <el-form-item label="占位提示"><el-input v-model="sel.props.placeholder" placeholder="留空为默认" /></el-form-item>
            <el-form-item label="必填">
              <el-switch v-model="sel.props.required" />
              <span class="hint">所有环节可见即必填（节点权限矩阵可覆盖）</span>
            </el-form-item>

            <template v-if="sel.type === 'radio' || sel.type === 'select'">
              <el-form-item label="选项（每行一个，可写 显示名=值）">
                <el-input v-model="optionsText" type="textarea" :rows="4" />
              </el-form-item>
            </template>
            <template v-if="sel.type === 'integer' || sel.type === 'float'">
              <el-form-item label="最小值"><el-input-number v-model="sel.props.min" :value-on-clear="undefined" /></el-form-item>
              <el-form-item label="最大值"><el-input-number v-model="sel.props.max" :value-on-clear="undefined" /></el-form-item>
            </template>
            <template v-if="sel.type === 'input'">
              <el-form-item label="最大长度"><el-input-number v-model="sel.props.maxLength" :min="1" :value-on-clear="undefined" /></el-form-item>
            </template>
            <template v-if="sel.type === 'multiInput'">
              <el-form-item label="最多项数"><el-input-number v-model="sel.props.maxCount" :min="1" :value-on-clear="undefined" /></el-form-item>
            </template>
            <template v-if="sel.type === 'calendar'">
              <el-form-item label="选择时间">
                <el-switch v-model="sel.props.showTime" />
                <span class="hint">开启后可选"日期+时间"</span>
              </el-form-item>
            </template>

            <el-divider>显隐联动（低代码）</el-divider>
            <el-form-item label="启用联动">
              <el-switch v-model="useVisible" />
              <span class="hint">满足全部条件时显示</span>
            </el-form-item>
            <template v-if="useVisible">
              <div v-for="(row, ri) in condRows" :key="ri" class="cond-row">
                <el-select v-model="row.key" placeholder="字段" size="small" style="width: 130px">
                  <el-option v-for="f in fieldOptions" :key="f.key" :label="f.label" :value="f.key" />
                </el-select>
                <el-select v-model="row.op" size="small" style="width: 88px">
                  <el-option label="=" value="==" /><el-option label="≠" value="!=" />
                  <el-option label=">" value=">" /><el-option label="≥" value=">=" />
                  <el-option label="<" value="<" /><el-option label="≤" value="<=" />
                </el-select>
                <el-input v-model="row.value" size="small" placeholder="值" style="width: 84px" />
                <el-button size="small" text type="danger" @click="condRows.splice(ri, 1)">删</el-button>
              </div>
              <el-button size="small" @click="condRows.push({ key: '', op: '==', value: '' })">+ 添加条件</el-button>
            </template>

            <el-divider>字段 Key</el-divider>
            <el-input v-model="sel.key" disabled size="small" />
          </el-form>
        </template>
        <el-empty v-else description="点击画布中的字段进行设置" :image-size="60" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const route = useRoute();
const appId = Number(route.params.appId);

const components = ref<any[]>([]);
const versions = ref<any[]>([]);
const versionId = ref<number>();
const selectedIdx = ref(-1);
const dragIdx = ref(-1);
const dropIndex = ref(-1);
const dragFromPalette = ref<string | null>(null);

const paletteGroups = [
  { name: '基础字段', items: [
    { type: 'input', label: '单行文本', icon: '✏️' },
    { type: 'textarea', label: '多行文本', icon: '📝' },
    { type: 'integer', label: '整数', icon: '🔢' },
    { type: 'float', label: '小数', icon: '10️⃣' },
    { type: 'calendar', label: '日期', icon: '📅' },
    { type: 'radio', label: '单选', icon: '🔘' },
    { type: 'select', label: '下拉选择', icon: '🔽' },
    { type: 'multiInput', label: '多项输入', icon: '📋' },
  ] },
  { name: '高级字段', items: [
    { type: 'userPicker', label: '人员选择', icon: '👤' },
    { type: 'file', label: '附件', icon: '📎' },
  ] },
];

// ---- 加载/保存 ----
const refresh = async () => {
  versions.value = await api('get', `/system/form?appId=${appId}`);
  if (versions.value.length && !versionId.value) { versionId.value = versions.value[0].id; loadVersion(); }
};
onMounted(refresh);

function loadVersion() {
  const v = versions.value.find((x) => x.id === versionId.value);
  components.value = v ? JSON.parse(JSON.stringify(v.snapshot.components)) : [];
  selectedIdx.value = -1;
}

async function saveDraft() {
  if (!components.value.length) return ElMessage.warning('画布为空');
  const row = await api<{ id: number }>('post', '/system/form', { appId, components: components.value });
  versionId.value = row.id;
  ElMessage.success(`已保存为版本 #${row.id}，点击"发布此版本"生效`);
  refresh();
}

async function publish() {
  if (!versionId.value) return ElMessage.warning('请先保存草稿');
  await api('post', `/system/form/${versionId.value}/publish`);
  ElMessage.success('版本已发布（自动绑定事项，即刻生效）');
  refresh();
}

// ---- 增删改 ----
function newComponent(type: string) {
  const meta = paletteGroups.flatMap((g) => g.items).find((p) => p.type === type)!;
  const props: any = {};
  if (['radio', 'select'].includes(type)) props.options = [{ name: '选项一', value: 'opt1' }, { name: '选项二', value: 'opt2' }];
  if (['integer', 'float'].includes(type)) { props.min = 0; props.max = 100; }
  if (type === 'input') props.maxLength = 200;
  if (type === 'multiInput') props.maxCount = 5;
  return { type, key: `${type[0].toUpperCase()}${type.slice(1)}_${Math.random().toString(36).slice(2, 8)}`, label: meta.label, props };
}

function addComponent(p: { type: string }) {
  components.value.push(newComponent(p.type));
  selectedIdx.value = components.value.length - 1;
}

function removeAt(i: number) {
  components.value.splice(i, 1);
  if (selectedIdx.value === i) selectedIdx.value = -1;
}

function duplicate(i: number) {
  const copy = JSON.parse(JSON.stringify(components.value[i]));
  copy.key = `${copy.type[0].toUpperCase()}${copy.type.slice(1)}_${Math.random().toString(36).slice(2, 8)}`;
  components.value.splice(i + 1, 0, copy);
  selectedIdx.value = i + 1;
}

// ---- 拖拽 ----
function onPaletteDragStart(e: DragEvent, p: { type: string }) {
  dragFromPalette.value = p.type;
  e.dataTransfer?.setData('text/plain', 'palette:' + p.type);
}
function onItemDragStart(e: DragEvent, i: number) {
  dragIdx.value = i;
  e.dataTransfer?.setData('text/plain', 'move:' + i);
}
function onItemDragOver(i: number) {
  dropIndex.value = dragIdx.value === -1 || i !== dragIdx.value && i !== dragIdx.value + 1 ? i : -1;
}
function onCanvasDrop(e: DragEvent) {
  e.preventDefault();
  const data = e.dataTransfer?.getData('text/plain') ?? '';
  const idx = dropIndex.value >= 0 ? dropIndex.value : components.value.length;
  if (data.startsWith('palette:')) {
    const c = newComponent(data.slice(8));
    components.value.splice(idx, 0, c);
    selectedIdx.value = idx;
  } else if (data.startsWith('move:')) {
    const from = Number(data.slice(5));
    if (from !== idx && from + 1 !== idx) {
      const [item] = components.value.splice(from, 1);
      const to = from < idx ? idx - 1 : idx;
      components.value.splice(to, 0, item);
      selectedIdx.value = to;
    }
  }
  dragFromPalette.value = null;
  dragIdx.value = -1;
  dropIndex.value = -1;
}

// ---- 属性面板 ----
const sel = computed(() => components.value[selectedIdx.value] ?? null);
const fieldOptions = computed(() => components.value.filter((c) => c.key !== sel.value?.key));
const useVisible = ref(false);
const condRows = ref<{ key: string; op: string; value: string }[]>([]);
const optionsText = ref('');

// 选中变化时同步面板
watch(selectedIdx, () => {
  const c = sel.value;
  if (!c) return;
  useVisible.value = Boolean(c.visibleIf);
  condRows.value = parseConditions(c.visibleIf);
  optionsText.value = (c.props?.options ?? []).map((o: any) => (typeof o === 'object' ? `${o.name}=${o.value}` : o)).join('\n');
}, { immediate: true });

// 面板改动实时写回组件
watch(useVisible, (v) => { if (!v && sel.value) delete sel.value.visibleIf; });
watch([condRows, useVisible], () => {
  const c = sel.value;
  if (!c || !useVisible.value) return;
  const when = compileConditions(condRows.value);
  const hasInput = condRows.value.some((r) => r.key && r.value !== '');
  if (when) c.visibleIf = when;
  else if (hasInput) { /* 未填完整，暂不写入 */ }
  else delete c.visibleIf;
}, { deep: true });
watch(optionsText, (t) => {
  const c = sel.value;
  if (!c || !['radio', 'select'].includes(c.type)) return;
  c.props.options = t.split('\n').filter(Boolean).map((line) => {
    const [name, value] = line.split('=');
    return value ? { name: name.trim(), value: value.trim() } : { name: line.trim(), value: line.trim() };
  });
});

function opts(c: any): { name: string; value: string }[] {
  return (c.props?.options ?? []).map((o: any) => (typeof o === 'object' ? o : { name: String(o), value: String(o) }));
}

const NUM_OPS = ['>', '>=', '<', '<='];
function compileConditions(rows: { key: string; op: string; value: string }[]): any | undefined {
  const valid = rows.filter((r) => r.key && r.value !== '');
  if (!valid.length) return undefined;
  const one = (r: { key: string; op: string; value: string }) => ({ [r.op]: [{ var: 'form.' + r.key }, NUM_OPS.includes(r.op) ? Number(r.value) : r.value] });
  return valid.length === 1 ? one(valid[0]) : { and: valid.map(one) };
}
function parseConditions(expr: any): { key: string; op: string; value: string }[] {
  if (!expr || typeof expr !== 'object') return [{ key: '', op: '==', value: '' }];
  const flat = (e: any): any[] => (e.and ? e.and.flatMap(flat) : [e]);
  return flat(expr).map((e: any) => {
    const [op, args] = Object.entries(e)[0] as [string, any[]];
    return { key: String(args[0]?.var ?? '').replace(/^form\./, ''), op, value: String(args[1] ?? '') };
  });
}
</script>

<style scoped>
.designer { display: flex; flex-direction: column; height: calc(100vh - 120px); }
.topbar { display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 16px; border-radius: 8px; margin-bottom: 12px; }
.title { font-weight: 600; }
.cols { display: flex; gap: 12px; flex: 1; min-height: 0; }
.palette, .props { width: 250px; background: #fff; border-radius: 8px; padding: 12px; overflow: auto; flex-shrink: 0; }
.panel-title { font-weight: 600; margin-bottom: 10px; }
.palette-group { margin-bottom: 12px; }
.group-name { color: #909399; font-size: 12px; margin-bottom: 6px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pal-item { border: 1px solid #e4e7ed; border-radius: 6px; padding: 8px 6px; text-align: center; font-size: 13px; cursor: grab; user-select: none; background: #fafbfc; }
.pal-item:hover { border-color: #409eff; color: #409eff; background: #ecf5ff; }
.pal-icon { margin-right: 4px; }
.tip { color: #c0c4cc; font-size: 12px; margin-top: 12px; text-align: center; }

.canvas-wrap { flex: 1; overflow: auto; }
.canvas { min-height: 100%; background: #f0f2f5; border: 1px dashed #dcdfe6; border-radius: 8px; padding: 16px; }
.empty { text-align: center; color: #c0c4cc; padding: 80px 0; }
.field-card { background: #fff; border: 1.5px solid #e4e7ed; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; cursor: grab; }
.field-card:hover { border-color: #a0cfff; }
.field-card.selected { border-color: #409eff; box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2); }
.field-card.dragging { opacity: 0.4; }
.field-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.drag-handle { color: #c0c4cc; cursor: grab; }
.field-label { font-weight: 600; font-size: 14px; }
.cond-tag { margin-left: 4px; }
.spacer { flex: 1; }
.field-body :deep(.el-input.is-disabled .el-input__inner),
.field-body :deep(.el-textarea.is-disabled .el-textarea__inner) { color: #909399; background: #fafbfc; cursor: default; }
.multi-preview { display: flex; gap: 8px; }
.ghost-box { border: 1px dashed #dcdfe6; border-radius: 6px; padding: 14px; text-align: center; color: #909399; background: #fafbfc; }
.drop-line { height: 3px; background: #409eff; border-radius: 2px; margin: 6px 0; }
.canvas-end { text-align: center; color: #c0c4cc; font-size: 12px; padding: 8px 0; }

.props .hint { color: #c0c4cc; font-size: 12px; margin-left: 8px; }
.cond-row { display: flex; gap: 4px; margin-bottom: 6px; align-items: center; }
.props :deep(.el-divider__text) { font-size: 12px; color: #909399; }
</style>
