// ===== 基础类型 =====
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type Json = Record<string, JsonValue>;

export interface Principal {
  uid: number;
  name: string;
  number: string;
  department: string;
  departmentId: number;
  roles: string[];
  group?: string;              // 用户组
}

export type FieldAuth = 'writable' | 'require' | 'front_readonly' | 'readable' | 'forbidden';

// ===== 表单 =====
export interface ComponentDef {
  type: string;
  key: string;
  label: string;
  props: Json;                 // placeholder/options/min/max/regex/multiple...
  visibleIf?: Expr;            // 联动显隐（JSONLogic 风格表达式）
  validators?: ValidatorRef[];
}

export interface ValidatorRef { kind: string; params?: Json; message?: string }

export interface FormSnapshot {
  formId: number;
  version: string;
  versionId: number;
  components: ComponentDef[];
}

// ===== 流程 =====
export interface Expr { [op: string]: JsonValue } // {"==":[{"var":"form.Input_1"},"x"]}

export interface AssigneeSpec {
  kind: 'fixed' | 'initiator' | 'dept_leader' | 'role' | 'group' | 'initiator_choose' | 'expr';
  value?: JsonValue;           // fixed: [uid] | role/group: "key" | expr: Expr
  dealMode?: 'or' | 'all';     // or:任一人处理(候选) all:会签(每人一个任务)
  // 仅 initiator_choose：发起人可选的候选人范围
  scope?: {
    kind: 'all' | 'role' | 'group' | 'department' | 'fixed';
    value?: JsonValue;         // role/group: key | department: departmentId | fixed: [uid]
  };
}

export interface ActionSpec {
  code: string;                // approve/reject/delegate/addSign/自定义
  name: string;                // 显示名
  opinionRequired?: boolean;
  attachmentRequired?: boolean;
  needSignature?: boolean;
  backTo?: string;             // reject 时的回退节点 id / 'start' / 'end'
}

export interface RoutingSpec {
  kind: 'sequential' | 'conditional' | 'parallel';
  next?: string;               // sequential
  branches?: { when: Expr; to: string }[];  // conditional
  fallback?: string;           // conditional 兜底
  to?: string[];               // parallel
}

export interface FlowNode {
  id: string;                  // "UserTask_1" / "start" / "end"
  kind: 'start' | 'userTask' | 'end';
  name: string;
  assignee?: AssigneeSpec;
  auths: Record<string, Record<string, FieldAuth>>;  // formId -> componentKey -> auth
  draftAuths?: Record<string, Record<string, FieldAuth>>; // 发起节点草稿态权限
  actions?: ActionSpec[];
  routing?: RoutingSpec;
  allowForce?: boolean;        // 管理员可对该节点强制通过/退回（发布时可全局设置）
  timerHours?: number;         // 超时小时（>0 时触发自动催办）
}

export interface FlowSnapshot {
  flowId: number;
  version: string;
  versionId: number;
  nodes: FlowNode[];
  variables: { key: string; name: string; source: 'form' | 'user' | 'custom' }[];
}

// ===== 运行时 =====
export interface NodeRuntime {
  nodeId: string;
  taskIds: number[];
  enteredAt: string;
  finishedAt?: string;
}

export interface Instance {
  id: number;
  appId: number;
  appSnapshot: { name: string };
  flowVersionId: number;
  formVersionId: number;
  data: Json;                  // 表单数据（键=componentKey）
  vars: Json;                  // 自定义流程变量
  status: 'draft' | 'running' | 'suspended' | 'finished' | 'revoked' | 'rejected';
  currentNodes: NodeRuntime[];
  pendingChoice?: number[];    // 发起人指定的审批人（跨节点暂存，到达 initiator_choose 节点时消费）
  createdBy: number;
  createdAt: string;
  finishedAt?: string;
  progress: number;
  history: { nodeId: string; taskIds: number[] }[]; // 已完成的节点
}

export interface Task {
  id: number;
  instanceId: number;
  nodeId: string;
  nodeName: string;
  assignee: number | null;
  candidates: number[];
  status: 'pending' | 'claimed' | 'waiting-sign' | 'dealt' | 'cancelled';
  parentTaskId?: number;       // 加签子任务指向主任务
  signMode?: 'before';
  createdAt: string;
  dealtAt?: string;
  dealtBy?: number;
  dealtAction?: string;
}

export interface ApprovalLog {
  id: number;
  instanceId: number;
  taskId: number | null;
  nodeId: string;
  nodeName: string;
  actorUid: number;
  actorName: string;
  action: string;              // 语义名：submit/approve/reject/delegate/add-sign/urge/revoke/notify
  comment: string;
  attachments: JsonValue[];
  snapshot: Json;              // deal_data 全量快照（审计）
  createdAt: string;
}

export interface Message {
  id: number;
  toUid: number;
  title: string;
  body: string;
  instanceId?: number;
  taskId?: number;
  kind?: 'notify' | 'read';    // notify:系统消息 read:知会
  read: boolean;
  createdAt: string;
}

// ===== 引擎上下文 =====
export interface ExprCtx {
  vars: Json;                  // instance.vars + 内置变量
  form: Json;                  // 当前表单数据
  actor?: Principal;
}

export interface ValidateCtx { data: Json; actor?: Principal }

export interface FieldError { key: string; label: string; message: string }
