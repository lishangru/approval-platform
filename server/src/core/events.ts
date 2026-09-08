import { EventEmitter } from 'node:events';

export type DomainEvent =
  | { type: 'TaskCreated'; instanceId: number; taskId: number; nodeId: string; nodeName: string; assignee: number | null; candidates: number[]; parentTaskId?: number }
  | { type: 'TaskDealt'; instanceId: number; taskId: number; nodeId: string; action: string; actorUid: number; actorName: string }
  | { type: 'InstanceSubmitted'; instanceId: number; appId: number; createdBy: number }
  | { type: 'InstanceFinished'; instanceId: number; appId: number; status: string }
  | { type: 'InstanceRevoked'; instanceId: number; byUid: number }
  | { type: 'Notify'; toUids: number[]; title: string; body: string; instanceId?: number; taskId?: number };

export class EventBus extends EventEmitter {
  emitEvent(e: DomainEvent) {
    this.emit(e.type, e);
    this.emit('*', e);
  }
}

// 横切能力全部挂在这里：通知 / 催办 / 签章 / 支付 / 归档……
export const bus = new EventBus();
bus.setMaxListeners(50);
