<template>
  <el-card>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <h3 style="margin: 0">表单设计 · 事项 #{{ appId }}</h3>
      <div>
        <el-select v-model="versionId" placeholder="历史版本" style="width: 200px; margin-right: 8px" @change="loadVersion">
          <el-option v-for="v in versions" :key="v.id" :label="`#${v.id} ${v.version}（${v.status}）`" :value="v.id" />
        </el-select>
        <el-button @click="saveDraft">保存草稿</el-button>
        <el-button type="success" plain @click="publish">发布此版本</el-button>
        <el-button type="primary" @click="addComponent">+ 添加组件</el-button>
      </div>
    </div>

    <el-table :data="components" border row-key="key">
      <el-table-column prop="key" label="字段 Key" width="150" />
      <el-table-column prop="label" label="标题" width="150">
        <template #default="{ row }">{{ row.label }}<el-tag v-if="row.props?.required" size="small" type="danger" style="margin-left: 6px">必填</el-tag></template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="120" />
      <el-table-column label="预览" min-width="200">
        <template #default="{ row }">{{ preview(row) }}</template>
      </el-table-column>
      <el-table-column label="显隐联动" width="150">
        <template #default="{ row }">{{ visibleDesc(row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row, $index }">
          <el-button size="small" @click="editComponent(row)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="components.splice($index, 1)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="editVisible" :title="editing?.key ? '编辑组件' : '添加组件'" width="560px">
    <el-form label-width="110px">
      <el-form-item label="组件类型">
        <el-select v-model="editForm.type" :disabled="Boolean(editing?.key)" style="width: 100%">
          <el-option v-for="t in types" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="标题"><el-input v-model="editForm.label" /></el-form-item>
      <el-form-item label="占位提示"><el-input v-model="editForm.placeholder" /></el-form-item>
      <template v-if="editForm.type === 'radio' || editForm.type === 'select'">
        <el-form-item label="选项（每行一个）">
          <el-input v-model="editForm.optionsText" type="textarea" :rows="3" placeholder="显示名=值 或直接写显示名" />
        </el-form-item>
      </template>
      <template v-if="editForm.type === 'integer' || editForm.type === 'float'">
        <el-form-item label="最小值"><el-input-number v-model="editForm.min" /></el-form-item>
        <el-form-item label="最大值"><el-input-number v-model="editForm.max" /></el-form-item>
      </template>
      <template v-if="editForm.type === 'input'">
        <el-form-item label="最大长度"><el-input-number v-model="editForm.maxLength" :min="1" /></el-form-item>
      </template>
      <el-form-item label="必填">
        <el-switch v-model="editForm.required" />
        <span style="color: #909399; font-size: 12px; margin-left: 8px">开启后所有环节填写该项都必填（节点权限矩阵仍可覆盖）</span>
      </el-form-item>
      <template v-if="editForm.type === 'calendar'">
        <el-form-item label="选择时间">
          <el-switch v-model="editForm.showTime" />
          <span style="color: #909399; font-size: 12px; margin-left: 8px">开启后可选择"日期 + 时间"，否则仅日期</span>
        </el-form-item>
      </template>
      <el-divider>显隐联动（低代码）</el-divider>
      <el-form-item label="启用联动">
        <el-switch v-model="editForm.useVisible" />
        <span style="color: #909399; font-size: 12px; margin-left: 8px">满足全部条件时该字段显示，否则隐藏</span>
      </el-form-item>
      <template v-if="editForm.useVisible">
        <el-form-item v-for="(c, i) in editForm.conditions" :key="i" :label="i === 0 ? '条件（且）' : ''" :label-width="i === 0 ? '110px' : '0px'">
          <div class="cond-row">
            <el-select v-model="c.key" placeholder="表单字段" style="width: 190px">
              <el-option v-for="f in fieldOptions" :key="f.key" :label="`${f.label}（${f.key}）`" :value="f.key" />
            </el-select>
            <el-select v-model="c.op" style="width: 110px">
              <el-option label="等于" value="==" />
              <el-option label="不等于" value="!=" />
              <el-option label="大于" value=">" />
              <el-option label="大于等于" value=">=" />
              <el-option label="小于" value="<" />
              <el-option label="小于等于" value="<=" />
            </el-select>
            <el-input v-model="c.value" placeholder="比较值" style="width: 140px" />
            <el-button type="danger" text @click="editForm.conditions.splice(i, 1)">删除</el-button>
          </div>
        </el-form-item>
        <el-form-item label=" ">
          <el-button size="small" @click="editForm.conditions.push({ key: '', op: '==', value: '' })">+ 添加条件</el-button>
        </el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" @click="saveComponent">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const route = useRoute();
const appId = Number(route.params.appId);
const components = ref<any[]>([]);
const versions = ref<any[]>([]);
const versionId = ref<number>();
const editVisible = ref(false);
const editing = ref<any>(null);

const types = [
  { value: 'input', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'radio', label: '单选' },
  { value: 'select', label: '下拉选择' },
  { value: 'calendar', label: '日期' },
  { value: 'integer', label: '整数' },
  { value: 'float', label: '小数' },
  { value: 'multiInput', label: '多项输入' },
  { value: 'userPicker', label: '选人' },
  { value: 'file', label: '附件' },
];

const editForm = reactive({
  type: 'input', label: '', placeholder: '', optionsText: '', min: 0, max: 100, maxLength: 200,
  required: false, showTime: false, useVisible: false, conditions: [] as { key: string; op: string; value: string }[],
});

// 可引用的字段 = 本表单的其他组件
const fieldOptions = computed(() => components.value.filter((c) => c.key !== editing.value?.key));

// —— 低代码条件 <-> 表达式（与流程设计器/后端 expr.ts 同构）——
const NUM_OPS = ['>', '>=', '<', '<='];
function compileConditions(rows: { key: string; op: string; value: string }[]): any | undefined {
  const valid = rows.filter((r) => r.key && r.value !== '');
  if (!valid.length) return undefined;
  const one = (r: { key: string; op: string; value: string }) => ({
    [r.op]: [{ var: 'form.' + r.key }, NUM_OPS.includes(r.op) ? Number(r.value) : r.value],
  });
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

const refresh = async () => {
  versions.value = await api('get', `/system/form?appId=${appId}`);
  if (versions.value.length && !versionId.value) { versionId.value = versions.value[0].id; loadVersion(); }
};
onMounted(refresh);

async function loadVersion() {
  const v = versions.value.find((x) => x.id === versionId.value);
  components.value = v ? JSON.parse(JSON.stringify(v.snapshot.components)) : [];
}

function preview(c: any) {
  if (c.type === 'radio' || c.type === 'select') return (c.props?.options ?? []).map((o: any) => o.name ?? o).join(' / ');
  if (c.type === 'integer' || c.type === 'float') return `${c.props?.min ?? '-'} ~ ${c.props?.max ?? '-'}`;
  if (c.type === 'calendar') return c.props?.showTime ? '日期 + 时间' : '仅日期';
  return c.props?.placeholder ?? '—';
}

const OP_NAME: Record<string, string> = { '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
function visibleDesc(c: any) {
  if (!c.visibleIf) return '—';
  const flat = (e: any): string[] => (e.and ? e.and.flatMap(flat) : [e]);
  const parts = flat(c.visibleIf).map((e: any) => {
    const [op, args] = Object.entries(e)[0] as [string, any[]];
    const f = components.value.find((x) => x.key === String(args[0]?.var ?? '').replace(/^form\./, ''));
    return `${f?.label ?? args[0]?.var} ${OP_NAME[op] ?? op} ${args[1]}`;
  });
  return parts.join(' 且 ');
}

function addComponent() {
  editing.value = null;
  Object.assign(editForm, { type: 'input', label: '', placeholder: '', optionsText: '', min: 0, max: 100, maxLength: 200, required: false, showTime: false, useVisible: false, conditions: [{ key: '', op: '==', value: '' }] });
  editVisible.value = true;
}

function editComponent(row: any) {
  editing.value = row;
  Object.assign(editForm, {
    type: row.type, label: row.label, placeholder: row.props?.placeholder ?? '',
    optionsText: (row.props?.options ?? []).map((o: any) => (typeof o === 'object' ? `${o.name}=${o.value}` : o)).join('\n'),
    min: Number(row.props?.min ?? 0), max: Number(row.props?.max ?? 100), maxLength: Number(row.props?.maxLength ?? 200),
    required: row.props?.required === true,
    showTime: row.props?.showTime === true,
    useVisible: Boolean(row.visibleIf),
    conditions: parseConditions(row.visibleIf),
  });
  editVisible.value = true;
}

function saveComponent() {
  if (!editForm.label) return ElMessage.warning('请填写标题');
  const def: any = {
    type: editForm.type,
    key: editing.value?.key ?? `${editForm.type[0].toUpperCase()}${editForm.type.slice(1)}_${Date.now().toString(36)}`,
    label: editForm.label,
    props: {},
  };
  if (editForm.placeholder) def.props.placeholder = editForm.placeholder;
  if (editForm.required) def.props.required = true;
  if (editForm.type === 'calendar' && editForm.showTime) def.props.showTime = true;
  if (['radio', 'select'].includes(editForm.type)) {
    def.props.options = editForm.optionsText.split('\n').filter(Boolean).map((line) => {
      const [name, value] = line.split('=');
      return value ? { name: name.trim(), value: value.trim() } : { name: line.trim(), value: line.trim() };
    });
  }
  if (['integer', 'float'].includes(editForm.type)) { def.props.min = editForm.min; def.props.max = editForm.max; }
  if (editForm.type === 'input' && editForm.maxLength) def.props.maxLength = editForm.maxLength;
  if (editForm.useVisible) {
    const when = compileConditions(editForm.conditions);
    if (editForm.conditions.some((c) => c.key && c.value !== '') && !when) return ElMessage.warning('显隐条件未填写完整');
    if (when) def.visibleIf = when;
  }
  if (editing.value) Object.assign(editing.value, def);
  else components.value.push(def);
  editVisible.value = false;
}

async function saveDraft() {
  const row = await api<{ id: number }>('post', '/system/form', { appId, components: components.value });
  versionId.value = row.id; // 自动选中新版本，"发布此版本"即发布刚保存的内容
  ElMessage.success(`已保存为版本 #${row.id}，点击"发布此版本"生效`);
  refresh();
}

async function publish() {
  if (!versionId.value) return ElMessage.warning('请先保存草稿');
  const cur = versions.value.find((v) => v.id === versionId.value);
  await api('post', `/system/form/${versionId.value}/publish`);
  ElMessage.success(cur && cur.status !== 'published' ? '版本已发布' : '版本已发布（更新）');
  refresh();
}
</script>
