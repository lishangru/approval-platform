# 审批平台（approval-platform）

设计的完整审批流平台。
**Node.js 25 + TypeScript + Express + Vue3 + Element Plus**，JSON 文件存储（Repository 抽象，可换 PG/Prisma）。

## 启动

```powershell
# 1. 后端（端口 3001，首次启动自动写入演示数据）
cd approval-platform\server
npm install
npm run dev

# 2. 前端（端口 5173，/api /site /system 已代理到 3001）
cd ..\web
npm install
npm run dev

# 3. 浏览器打开 http://localhost:5173
```

演示账号：

| 账号 | 密码 | 身份 |
|---|---|---|
| lishangru | 123456 | 学生（机电学院，用户组：机电学院-研究生会） |
| wangjianguo | 123456 | 机电学院负责人（部门主管） |
| zhangmin | 123456 | 学工处（office 角色，用户组：学工处-审核组） |
| liuzhen | 123456 | 学工处（用户组：学工处-审核组，与张敏共享组待办） |
| xiaozhang | 123456 | 校长办公室（school 角色） |
| admin | admin123 | 管理员（可进管理端设计事项） |

## 演示事项「会议室预约」的流程

```
发起(李尚儒) → 部门负责人审批(王建国) → 学工处审核(张敏)
                 ↑ 退回修改                │ 条件路由（低代码配置）
                 │                        ├─ 时长 ≤ 4h → 结束
                 └────────────────────────┴─ 时长 > 4h → 校级备案(张校长) → 结束
                                  （校级备案节点默认禁止管理员强制审批）
```
可体验：字段级必填校验、节点权限（学工处可修改时长）、条件分支、退回重报、撤销、消息通知。

## 管理员强制审批

- 流程设计器每个节点可单独设置「允许强制审批」；发布上线时也可全局覆盖（"允许后一级强制审批"开关）。
- 允许后，管理员在申请详情页可 **强制通过**（当前节点全部待办直接放行进入下一环节）或 **强制退回**（直接终结申请）。
- 每次强制操作写入审批日志（`强制通过（管理员）`/`强制退回（管理员）` + 备注），可审计。
- 后端接口：`POST /site/instance/:id/force {action:'approve'|'reject', comment}`，仅 admin 角色，且节点 `allowForce=true` 时才生效。
- 测试：`node scripts/force-test.mjs`

## 条件路由低代码

流程设计器中条件不再手写 JSON，而是"字段 + 操作符 + 值"的表单行（多行且关系）：

```
[使用时长（Integer_4）] [大于 >] [4]    → 满足时去向：校级备案审批
                                        兜底去向：结束
```
支持操作符：等于/不等于/大于/大于等于/小于/小于等于；保存时自动编译为 JSONLogic 表达式存入流程定义（导出/后端执行与手写表达式完全兼容，`parseConditions` 可反向解析回低代码行）。

## 表单设计能力

- 组件级 **必填** 开关：勾选后所有环节可见即必填（节点权限矩阵可覆盖）
- 日期组件 **是否选择时间** 开关：仅日期 / 日期+时间（`props.showTime`）
- 发起节点字段默认可写（无需在流程里逐个配置）；审批节点默认只读，可在权限矩阵调整
- 保存草稿后自动选中新版本，"发布此版本"即发布刚保存的内容

## 审批人规则

支持：部门主管 / 固定角色 / **用户组**（组内成员共享同一待办，可配或签/会签）/ 指定人员 / 发起人指定 / 表达式。

## 流程图

申请详情页的流程图为竖向节点图（参考原平台样式）：开始/结束为胶囊节点，审批节点显示处理人或待处理人，绿色=已办结、蓝色高亮=进行中、红色=已退回、灰色=未到达。

## 目录结构

```
server/src/
  core/          store.ts(JSON存储) events.ts(事件总线) registry.ts(策略注册表) types.ts(领域类型)
  domain/form/   engine.ts(表单引擎) registry.ts(组件接口) —— 10种内置组件
  domain/flow/   engine.ts(工作流引擎) actions.ts(动作策略) assignees.ts(审批人策略)
                 routing.ts(路由策略) expr.ts(JSONLogic表达式)
  services/      auth.ts(JWT+TOTP钩子+CAS适配器接口) notify.ts(事件订阅)
  api/routes.ts  /api /site /system 全部路由
  seed.ts        演示数据
web/src/
  views/         Login/Layout/Hall/Launch/MyInstances/InstanceDetail/Todo/Deal/Finished/Messages
  views/admin/   AdminApps(事项) AdminForm(表单设计器) AdminFlow(流程设计器)
  components/    FormRender(按auth矩阵渲染) FlowChart LogList
```

## 与 ehall3 的对应关系

| ehall3 接口 | 本平台接口 |
|---|---|
| `/site/process/start-info` | `GET /site/app/:id/start-info` |
| `/site/apps/launch` | `POST /site/instance/launch` |
| `/site/my-task/todo` | `GET /site/task/list?box=todo` |
| `/site/process/deal-info` | `GET /site/task/:id/deal-info` |
| `/site/task/deal` | `POST /site/task/:id/deal` |
| `/site/process/revoke` | `POST /site/instance/:id/revoke` |
| `/site/activiti/revoke` | 同上（撤销=终态） |
| `/site/process/change-approver` | `POST /site/instance/:id/change-approver` |
| `/site/process/log` `/variables` | `GET /site/instance/:id/detail` `/variables` |
| `/system/bpmn/*` `/system/form/*` | `POST /system/flow/*` `/system/form/*` |

## 扩展点（改一处注册，引擎零改动）

- **新组件**：`server/src/domain/form/engine.ts` 实现 `IComponent` → `components.register(...)`
- **新审批动作**：`domain/flow/actions.ts` 实现 `IActionHandler` → `actionRegistry.register(...)`（已内置 approve/reject/delegate/addSign；会签=节点 `dealMode:'all'`）
- **新审批人规则**：`domain/flow/assignees.ts` 实现 `IAssigneeResolver`（已内置 fixed/initiator/dept_leader/role/initiator_choose/expr）
- **新路由模式**：`domain/flow/routing.ts`（已内置 sequential/conditional/parallel）
- **横切能力**（企微通知/CA签章/支付/归档/催办定时器）：`services/notify.ts` 订阅 `EventBus` 领域事件
- **换存储**：实现 `core/store.ts` 的 `Table<T>` 接口（如 Prisma），引擎不改一行
- **接 CAS**：`services/auth.ts` 实现 `AuthAdapter`（流程见《CAS登录流程.md》）

## 测试

```powershell
cd server
node scripts/smoke.mjs   # 全链路：发起→审批→条件路由→退回重报→撤销 (22 项断言)
```

## 已知边界（下一步扩展方向）

- 附件为元数据占位，需接对象存储（MinIO/OSS）+ `/api/upload`
- 加签人目前只有"同意/不同意"，可扩展为完整多级加签链
- 定时器（超时自动催办/自动通过）字段已预留（`timerHours`），订阅器待接入 cron
- 会签历史在日志中为合并意见，可在 UI 上展开各会签人
- 管理端表单/流程设计器为简化版（线性串联），复杂 BPMN 网关可在流程 JSON 里直接编辑条件路由
