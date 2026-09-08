<template>
  <el-timeline style="padding-left: 4px">
    <el-timeline-item
      v-for="l in logs"
      :key="l.id"
      :timestamp="l.createdAt"
      :type="logType(l.action)"
    >
      <b>{{ l.actorName }}</b>
      <el-tag size="small" style="margin: 0 6px" :type="logType(l.action)">{{ l.action }}</el-tag>
      <span class="node">［{{ l.nodeName }}］</span>
      <div v-if="l.comment" class="comment">{{ l.comment }}</div>
      <div v-if="l.attachments?.length" class="att-list">
        <div v-for="(a, i) in l.attachments" :key="i" class="att-item">
          <a :href="a.url" target="_blank">📎 {{ a.name }}</a>
          <div class="att-meta">
            <div>地址：<code>{{ a.url }}</code></div>
            <div v-if="a.hash">SHA-256：<code>{{ a.hash }}</code></div>
          </div>
        </div>
      </div>
    </el-timeline-item>
  </el-timeline>
</template>

<script setup lang="ts">
defineProps<{ logs: { id: number; actorName: string; action: string; nodeName: string; comment: string; createdAt: string; attachments?: { name: string; url: string; hash?: string }[] }[] }>();
const logType = (a: string) => (a.includes('退回') || a.includes('不予') ? 'danger' : a.includes('催办') ? 'warning' : a.includes('同意') || a.includes('通过') || a.includes('备案') ? 'success' : 'info');
</script>

<style scoped>
.comment { color: #606266; margin-top: 4px; background: #f5f7fa; padding: 6px 10px; border-radius: 4px; display: inline-block; }
.node { color: #909399; }
.att-list { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.att-item a { color: #409eff; text-decoration: none; font-size: 13px; }
.att-meta { color: #909399; font-size: 12px; line-height: 1.6; }
.att-meta code { word-break: break-all; color: #67c23a; }
</style>
