<template>
  <div class="ftn" :class="{ 'ftn-untaken': isUntaken }">
    <!-- 节点本体（未走过的路径灰显且不显示状态标签） -->
    <div class="fc-node" :class="['st-' + (isUntaken ? 'pending' : node.state), node.kind === 'start' || node.kind === 'end' ? 'pill' : 'rect']">
      <div class="fc-node-head">
        <span class="fc-kind" :class="'k-' + node.kind">{{ kindName(node.kind) }}</span>
        <span class="fc-name">{{ node.name }}</span>
        <template v-if="!isUntaken">
          <el-tag v-if="node.state === 'current'" type="primary" size="small" effect="dark">进行中</el-tag>
          <el-tag v-else-if="node.state === 'done'" type="success" size="small" effect="plain">已办结</el-tag>
          <el-tag v-else-if="node.state === 'rejected'" type="danger" size="small" effect="plain">已退回</el-tag>
        </template>
        <el-tag v-else type="info" size="small" effect="plain">未走过</el-tag>
      </div>
      <div v-if="!isUntaken && node.handlers?.length" class="fc-people">
        <el-icon><User /></el-icon>
        <span>处理人：{{ node.handlers.join('、') }}</span>
      </div>
      <div v-else-if="!isUntaken && node.state === 'current' && node.candidates?.length" class="fc-people fc-waiting">
        <el-icon><Clock /></el-icon>
        <span>待处理：{{ node.candidates.join('、') }}</span>
      </div>
    </div>

    <template v-if="children.length">
      <div class="fc-line" :class="{ 'line-done': !isUntaken && node.state === 'done' }"><span class="fc-arrow">▼</span></div>

      <!-- 单一后继且无条件标签：直接串联 -->
      <FlowTreeNode
        v-if="children.length === 1 && !children[0].edge.label"
        :node="children[0].node" :edges="edges" :path="[...(path ?? []), children[0].node.id]"
        :untaken="isUntaken || children[0].edge.taken === false"
      />

      <!-- 多后继 / 带条件标签：网关 + 分支列 -->
      <div v-else class="branch-wrap">
        <div class="gateway">
          <span class="gw-icon">◇</span>
          <span>{{ gatewayName }}</span>
        </div>
        <div class="fc-line" :class="{ 'line-done': !isUntaken && node.state === 'done' }"><span class="fc-arrow">▼</span></div>
        <div class="branches">
          <div v-for="c in children" :key="c.edge.to + (c.edge.label ?? '')" class="branch-col" :class="{ 'branch-untaken': c.edge.taken === false }">
            <div v-if="c.edge.label" class="branch-label" :class="{ 'bl-else': c.edge.label === '否则' }">{{ c.edge.label }}</div>
            <div class="branch-arrow">↓</div>
            <FlowTreeNode :node="c.node" :edges="edges" :path="[...(path ?? []), c.node.id]" :untaken="isUntaken || c.edge.taken === false" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { User, Clock } from '@element-plus/icons-vue';

const props = defineProps<{
  node: any;
  edges: { from: string; to: string; label?: string; taken?: boolean }[];
  path?: string[];
  untaken?: boolean;
}>();

// 全量真实节点（状态/处理人由服务端下发），占位节点按 id 解析
const allNodes = inject<any[]>('flowNodes', []);
const node = computed(() => allNodes.find((n) => n.id === props.node.id) ?? props.node);

// 未走过：父链已灰 or 连接边被服务端判定未走过
const isUntaken = computed(() => Boolean(props.untaken));

const children = computed(() => {
  const seen = new Set(props.path ?? []);
  return props.edges
    .filter((e) => e.from === props.node.id)
    .map((edge) => ({
      edge,
      node: allNodes.find((n) => n.id === edge.to) ?? { id: edge.to, name: edge.to === 'end' ? '结束' : edge.to, kind: edge.to === 'end' ? 'end' : 'userTask', state: 'pending' },
    }))
    .filter((c) => !seen.has(c.node.id)); // 防止循环引用
});

const gatewayName = computed(() => {
  const l = children.value[0]?.edge.label ?? '';
  if (l.startsWith('满足')) return '条件判断';
  if (l === '并行') return '并行网关';
  return '分支';
});

const kindName = (k: string) => ({ start: '开始', end: '结束', userTask: '审批', gateway: '分支' }[k] ?? k);
</script>

<style scoped>
.ftn { display: flex; flex-direction: column; align-items: center; }
.ftn-untaken { opacity: 0.55; }
.ftn-untaken .fc-node { border-style: dashed; background: #fff; }
.fc-node { width: 380px; max-width: 92%; box-sizing: border-box; text-align: left; border: 1.5px solid #dcdfe6; background: #fafafa; padding: 10px 16px; }
.fc-node.pill { border-radius: 24px; }
.fc-node.rect { border-radius: 8px; }
.fc-node.st-done { border-color: #95d475; background: #f0f9eb; }
.fc-node.st-current { border-color: #409eff; background: #ecf5ff; box-shadow: 0 2px 8px rgba(64, 158, 255, 0.25); }
.fc-node.st-rejected { border-color: #f56c6c; background: #fef0f0; }
.fc-node-head { display: flex; align-items: center; gap: 8px; }
.fc-kind { font-size: 11px; padding: 1px 8px; border-radius: 10px; background: #909399; color: #fff; }
.k-start { background: #67c23a; }
.k-end { background: #909399; }
.k-userTask { background: #409eff; }
.fc-name { font-size: 14px; font-weight: 600; color: #303133; flex: 1; }
.fc-people { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 12px; color: #606266; }
.fc-waiting { color: #e6a23c; }
.fc-line { height: 22px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.fc-line::before { content: ''; width: 2px; flex: 1; background: #dcdfe6; }
.line-done::before { background: #95d475; }
.fc-arrow { color: #c0c4cc; font-size: 10px; line-height: 8px; }
.line-done .fc-arrow { color: #95d475; }

.branch-wrap { display: flex; flex-direction: column; align-items: center; }
.gateway { display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border: 1.5px dashed #e6a23c; border-radius: 14px; color: #e6a23c; font-size: 12px; font-weight: 600; background: #fdf6ec; }
.gw-icon { font-size: 14px; }
.branches { display: flex; align-items: flex-start; gap: 24px; }
.branch-col { display: flex; flex-direction: column; align-items: center; }
.branch-untaken { opacity: 0.55; }
.branch-untaken .branch-label { opacity: 0.6; }
.branch-label { font-size: 11px; color: #67c23a; background: #f0f9eb; border: 1px solid #e1f3d8; border-radius: 10px; padding: 1px 10px; max-width: 240px; text-align: center; }
.bl-else { color: #909399; background: #f4f4f5; border-color: #e9e9eb; }
.branch-arrow { color: #c0c4cc; font-size: 12px; line-height: 14px; }
</style>
