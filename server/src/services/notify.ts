import type { WorkflowEngine } from '../domain/flow/engine.js';
import { bus } from '../core/events.js';

// 事件订阅示例：通知中心已直接落库，这里演示横切扩展点（可接企微/短信/webhook）
export function registerSubscribers(engine: WorkflowEngine) {
  bus.on('InstanceFinished', (e) => {
    // e.g. 归档、统计、webhook 外发
    console.log(`[event] 实例 ${e.instanceId} 结束: ${e.status}`);
  });
  bus.on('TaskCreated', (e) => {
    console.log(`[event] 任务 ${e.taskId} 产生 @ ${e.nodeName}`);
  });
}
