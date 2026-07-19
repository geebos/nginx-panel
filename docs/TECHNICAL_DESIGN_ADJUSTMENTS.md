# 阶段性技术设计微调：日志查询、草稿编辑与发布引导

> 状态：Draft for implementation — `review_adjust.md` 已闭环  
> 日期：2026-07-19  
> 基线：`docs/PRD.md`、`docs/TECHNICAL_DESIGN.md`、`docs/review_adjust.md`、`DESIGN.md`  
> 适用范围：当前 Phase 2 配置与日志闭环的交互微调

## 1. 文档目的与覆盖关系

本文只描述本轮新增或改变的技术约束，不复制完整 PRD 和主技术设计。实现时仍以原文为基础，但以下冲突项由本文覆盖：

1. 日志筛选从“一份已应用筛选同时驱动历史和实时”改为“历史筛选与实时筛选分别生效”。
2. `config_versions` 从“任意保存都新建不可变版本”改为“已发布版本不可变，Domain 当前最新 Draft 可原位更新”。
3. 发布入口从 Overview 单点确认改为所有可编辑 Tab 共用的三步发布向导：Diff → Test → Publish。

本轮不包含：服务端保存用户日志表格偏好、多管理员偏好同步、任意 Nginx 日志格式、自动发布、跳过发布阶段的完整 candidate `nginx -t`。

## 2. 决策摘要

| 主题 | 决策 |
| --- | --- |
| 实时日志筛选 | 开启实时后，筛选控件变化经短 debounce 直接重连实时流；不刷新或覆盖历史结果 |
| 历史日志筛选 | 关闭实时时点击“查询”才应用；实时开启时仍可手动“刷新历史”，但使用最后一次历史筛选 |
| 日志类型 | UI 改为多选 Select，至少选择 Access/Error 之一；API 使用 `types=access,error` |
| Method | 仍为单选 Select，提供明确 Clear button；清空表示不过滤 Method |
| 日志列配置 | Domain Logs 与全局 Logs 都支持选择显示字段和调整顺序；偏好只保存在浏览器 `localStorage` |
| Draft 保存 | 若 `domains.draft_version_id` 指向最新 Draft，则 CAS 原位更新该行；否则创建下一版本号 Draft |
| 发布确认 | 共用三步 Dialog：显示带配色 Diff，创建并等待 Test Deployment，通过后才允许创建 Deploy Deployment |
| 发布安全 | Test 结果绑定 `versionId + snapshotChecksum`；Deploy API 校验 preflight，但发布 Runner 仍重新执行完整 `nginx -t` |
| 发布入口 | Overview、Routes、SSL、Headers、Advanced 显示统一“发布”按钮；Logs、History 不显示 |

## 3. 日志查询微调

### 3.1 前端状态拆分

`LogViewer` 不再使用单一 `filters`。改为三个明确状态：

```ts
type LogFilterValues = {
  keyword?: string;
  method?: string;
  status?: number;
};

type LogViewerState = {
  filterInputs: LogFilterValues;   // 控件当前值
  historyFilters: LogFilterValues; // 最近一次历史查询实际使用值
  liveFilters: LogFilterValues;    // 当前实时连接实际使用值
  live: boolean;                   // 是否启用实时连接
  paused: boolean;                 // 是否暂停把实时记录提交到可见列表
};
```

- `filterInputs` 只描述 UI，不可作为请求事实来源。
- `historyFilters` 只在提交历史查询时更新。
- `liveFilters` 在实时模式下由合法的 `filterInputs` 更新。
- `paused` 只控制实时记录是否进入可见列表，不冻结筛选状态或服务端连接；暂停期间的新记录进入有界 paused buffer。
- Domain、日志类型变化不属于普通文本筛选，始终立即切换当前数据源；切换时终止旧流。

### 3.2 生效规则

| 用户动作 | 实时关闭 | 实时开启 |
| --- | --- | --- |
| 修改 Method / Status / Keyword | 只修改控件，不发请求 | 校验后 debounce 250 ms，更新 `liveFilters` 并重连流 |
| 修改日志类型 | 立即按新类型重新查询历史 | 立即终止旧流并按新类型重连；历史结果不刷新 |
| 点击主按钮 | 按钮名为“查询”；将合法的 `filterInputs` 写入 `historyFilters` 并查询历史 | 同一按钮改名为“刷新历史”；仍使用 `historyFilters`，不使用正在实时生效的控件值 |
| 暂停时修改筛选 | 不适用 | abort 旧流、按新条件更新 `liveFilters` 并重连；保持暂停，新匹配记录进入 paused buffer |
| 暂停时关闭实时 | 不适用 | abort 流，清空 paused buffer/计数并将 `paused=false`；保留当前可见列表和 `historyFilters` |
| 重新开启实时 | 使用当前合法控件值建立新流；不自动刷新历史列表 | 已处于开启状态，不重复创建连接 |
| 关闭实时 | 主动 abort 流 | 保留当前历史列表和 `historyFilters`；控件值不自动回写历史条件 |
| 点击“清屏” | 清空查看器的可见记录与 paused buffer/计数 | 同左；不发起历史请求，不修改筛选、cursor 或连接状态 |

实时筛选变化时不清空现有历史记录。新流返回的记录继续追加到查看器；工具栏明确显示“实时条件已更新”。若需要严格区分不同条件的结果，用户使用“清屏”。

Status 必须先通过 `100–599` 整数校验。输入尚未合法时不重连，保留上一条有效实时连接，并就近显示字段错误。

### 3.3 日志类型多选

新增共享类型：

```ts
const logTypeSchema = z.enum(["access", "error"]);
const logTypesSchema = z.array(logTypeSchema).min(1).max(2);
type LogType = z.infer<typeof logTypeSchema>;
```

UI 使用支持多选的 Select/Combobox：

- 默认值：`["access", "error"]`。
- Trigger 文案：`Access + Error`、`Access` 或 `Error`。
- 不允许清空最后一项；尝试清空时保留当前值并提示“至少选择一种日志类型”。
- 选项使用 Checkbox 状态，键盘可操作，不用两个手写 Toggle Button 替代。

HTTP 契约调整：

```http
GET /api/logs/history?domainId=...&types=access,error
GET /api/logs/follow?domainId=...&types=access,error
```

服务端将 `types` 解析为去重、固定排序的数组。过渡期继续接受旧参数 `type=access|error|all`，两者同时出现时返回 `400 VALIDATION_ERROR`；前端只发送新参数。

历史 cursor 与实时 cursor 使用独立命名空间和签名：历史 cursor 绑定规范化后的 Domain、`types`、`historyFilters`、file ID/offset；实时 cursor 绑定 Domain、`types`、全部 `liveFilters`、file ID/offset。任一实时筛选变化后不得复用旧实时 cursor，但不会使历史 cursor 或已显示历史列表失效。

### 3.4 Method Clear button

Method 仍为单选，不改为多选。Select Trigger 右侧提供独立 Clear button：

- 有值时显示，`aria-label="清除 Method 筛选"`。
- 点击只清空 Method，不打开 Select，不影响其他条件。
- 实时开启时清空动作立即进入同一 250 ms debounce 并重连。
- 实时关闭时只修改 `filterInputs`，点击“查询”后才影响历史请求。

### 3.5 日志显示字段与顺序

“采集字段”和“显示字段”必须保持分离：

- `/settings/logs` 的 `NginxLogSettings.accessFields` 决定 Nginx 实际写入哪些字段，保存需要全局 Deployment。
- 查看器的列偏好只决定浏览器显示哪些已返回字段，不修改日志格式、不 reload Nginx。

共享偏好 Schema：

```ts
const logColumnIdSchema = z.enum([
  "timestamp", "log_type", "domain", "method", "status", "path",
  "request_uri", "request_time", "client_ip", "upstream_addr",
  "upstream_status", "upstream_time", "level", "message", "raw",
]);

const logColumnPreferenceSchema = z.object({
  schemaVersion: z.literal(1),
  columns: z.array(z.object({
    id: logColumnIdSchema,
    visible: z.boolean(),
  })).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});
```

数组顺序就是展示顺序，不另存 `order` 数字，避免出现重复或间断序号。偏好键：

```text
nginx-manager:log-columns:domain:v1
nginx-manager:log-columns:global:v1
```

Domain Logs 和全局 Logs 分别保存偏好；同一类页面的不同 Domain 复用同一份偏好。原因是这是展示习惯，不是 Domain 配置。当前阶段不做跨浏览器同步。

列配置 UI 使用“字段显示”Popover/Dropdown：

- Checkbox 控制显示；至少保留一个可见列。
- 支持拖拽排序，同时必须提供“上移/下移”键盘按钮。
- 提供“恢复默认顺序”。
- 全局 Logs 默认包含 Domain；Domain Logs 默认隐藏 Domain，但允许用户打开。
- Access 字段缺失或 Error 行不适用时显示 `-`，不能因此丢弃整行。
- 无法按当前 access 格式解析的行必须完整写入 `raw` 列，其他结构化字段显示 `-`，不能丢弃或部分猜测字段。
- `raw` 始终可选；原始内容继续按纯文本渲染，不使用 HTML。
- 新版本增加列 ID 时，将未知已存 ID 丢弃，并把新默认列追加到末尾；Schema 无法解析时回退默认值。

列配置旁显示说明“仅保存在当前浏览器”；清理浏览器数据会恢复默认显示字段与顺序。

默认顺序：

```text
Domain Logs: timestamp, log_type, method, status, request_uri, request_time
Global Logs: timestamp, domain, log_type, method, status, request_uri, request_time
```

Error 行的 `level/message` 在对应列启用时显示；当默认列中的 `request_uri` 不适用时，该单元格回退 `message`，但列详情配置仍保持字段语义。

### 3.6 组件边界

建议拆分为：

```text
LogViewer
├── LogFilterBar              输入、历史/实时生效策略
├── LogLiveControls           开关、暂停、清屏、连接状态
├── LogColumnPreferences      显示字段和顺序
└── LogRecordTable            按列偏好渲染
```

Domain Logs 与全局 Logs 必须复用上述组件和 Schema，不复制筛选状态机。全局多 Domain 仍受最多 20 个 Domain 的限制，本轮不改变服务端容量与 backpressure 策略。

## 4. 最新草稿原位更新

### 4.1 不可变边界调整

新的版本规则：

1. `active`、`superseded` 以及任何曾被发布引用的版本永不修改。
2. 每个 Domain 最多有一个可编辑 Draft，由 `domains.draft_version_id` 指向。
3. 当前 Draft 未发布前，多次保存原位更新同一 `config_versions.id` 和 `version_number`。
4. 当前不存在 Draft 时，以 Active Version 为基线创建 `version_number + 1` 的新 Draft。
5. 新建 Domain 的 v1 Draft 同样原位更新，首次发布后才冻结。

此调整牺牲“每次保存都有一条版本历史”，换取草稿列表不被小改动刷屏。Deployment、已发布 Version 和最终 Draft checksum 仍提供发布审计；本轮不新增草稿编辑事件表。

### 4.2 数据库变化

`config_versions` 增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `updated_at` | integer not null | Draft 最近更新时间；历史行迁移时取 `created_at` |

增加部分唯一索引，防止并发产生多个 Draft：

```sql
CREATE UNIQUE INDEX config_versions_one_draft_per_domain
ON config_versions(domain_id)
WHERE status = 'draft';
```

`created_at` 表示该版本号首次创建时间；Draft 原位保存只更新 `updated_at`、`snapshot_json`、`snapshot_checksum`、`change_summary` 和必要的来源字段。

### 4.3 保存事务与并发控制

保留完整 `DomainConfig` body 与 `If-Match`，不接受 section patch。服务端事务：

1. 读取未删除 Domain，并锁定逻辑上的 `draft_version_id ?? active_version_id`。
2. 当前可编辑 Version 的 `snapshot_checksum` 必须等于 `If-Match`，否则返回 `409 VERSION_CONFLICT`。
3. canonicalize、Zod/领域校验、hostname 唯一性校验并生成目标 snapshot/checksum。
4. checksum 未变化时返回 `{ changed:false, mode:"unchanged" }`。
5. 若 `draft_version_id` 存在且目标行 `status='draft'`，执行带旧 checksum 条件的 CAS `UPDATE`。
6. 否则创建下一版本号 Draft，并更新 `domains.draft_version_id`。
7. 同一事务更新 `domain_aliases`、`domains.primary_hostname/display_hostname/updated_at` 等草稿查询投影。

建议 API 保持路径兼容，响应补充模式：

```ts
type SaveDraftResponse = {
  changed: boolean;
  mode: "created" | "updated" | "unchanged";
  version: ConfigVersionResponse;
};
```

前端 Toast：

- `created`：`已创建 vN 草稿`
- `updated`：`已更新 vN 草稿`
- `unchanged`：`没有配置变化`

### 4.4 发布冻结

发布成功的最终事务继续完成：

- 目标 Draft `status` → `active`。
- 旧 Active → `superseded`。
- `domains.active_version_id` → 目标 Version。
- `domains.draft_version_id` → `null`。

发布失败时 Draft 保持可编辑。若用户在 Test 或 Deploy 排队期间继续保存同一个 Draft，必须由下面的 checksum 绑定机制拒绝陈旧发布，不能发布“同 ID 的新内容”。

Test Deployment 不锁定 Draft，保存后旧 Test 会因 checksum 不一致而失效。Deploy Deployment 不同：从创建 Deploy Deployment 到其进入终态期间，保存接口必须检查同 Domain/Version 的 `queued|running` deploy，并返回 `409 DRAFT_DEPLOYMENT_RUNNING`。这样 Runner 读取快照、生成文件、激活和最终提交期间，同一个 Draft 行不会再变化。

启动恢复必须同时处理锁释放：上一次进程遗留的 `running` Deploy 标记为 `failed/WORKER_INTERRUPTED`；`queued` Deploy 由恢复器重新入队并在排队/运行期间继续持锁，若因运行时不兼容、输入无效或降级状态而无法恢复，则必须标记为终态失败。任何失败或恢复终态都会自动解除限制，Version 仍为 Draft；不得遗留没有 worker 可以继续处理的 `queued|running` 僵尸锁。

## 5. 三步发布向导

### 5.1 入口和共享组件

新增 Domain 页面共享组件：

```text
DomainPageActions
└── PublishDomainDialog
    ├── Step 1: Diff
    ├── Step 2: Test
    └── Step 3: Publish
```

可编辑 Tab：Overview、Routes、SSL、Headers、Advanced。它们的 PageHeader 都显示同一个“发布”按钮，不各自实现发布状态机。Logs 和 History 是只读页，不显示发布按钮。

按钮规则：

- 没有 Draft：disabled，Tooltip `当前没有待发布草稿`。
- Domain Disabled：disabled，沿用 `DOMAIN_DISABLED` 规则并引导先启用。
- degraded 或存在冲突的非终态运行任务：disabled，并给出 Diagnostics/Deployment 入口。
- 当前表单有未保存修改：点击时先提示保存；不允许把 React 本地 state 当作发布内容。

### 5.2 Step 1：Diff

打开 Dialog 后以 `activeVersionId` 为 base、`draftVersionId` 为 target 请求发布预览。首次发布没有 Active 时，响应保持 `baseVersion/baseJson/baseNginx=null`；UI 只在 Diff 展示层把空基线显示为固定纯文本 `# 当前无活跃配置`，不调用编译器生成虚构的 root 配置。

新增聚合接口：

```http
GET /api/domains/:domainId/versions/:draftVersionId/publish-preview
```

响应：

```ts
type PublishPreviewResponse = {
  domainId: string;
  baseVersion: ConfigVersionResponse | null;
  targetVersion: ConfigVersionResponse;
  targetSnapshotChecksum: string;
  changes: SemanticDiffItem[];
  baseJson: string | null;
  targetJson: string;
  baseNginx: string | null;
  targetNginx: string;
};
```

Diff 默认展示语义变化，可切换 JSON/Nginx。配色遵循 `DESIGN.md` 的语义色，不新增任意色值：

- Added：success 图标/文本和低对比 success tint。
- Removed：destructive 图标/文本和低对比 destructive tint。
- Changed：before 使用 removed 样式，after 使用 added 样式；同时保留 `Changed` 文本 Badge。
- 未变化上下文：muted surface / muted foreground。
- 颜色必须同时配合 `+`、`-`、`Changed` 文本和图标，不能只靠颜色表达。

代码区域使用 monospace、可横向滚动；不显示证书私钥或真实敏感路径。Dialog 桌面宽度允许展示并排 before/after，小屏切为上下布局。

`publish-preview` 是纯读 GET，本身可安全重复调用，不使用 `Idempotency-Key`。Dialog 为每次打开或重新加载创建新的 `AbortController` 和请求代次，先取消旧请求；只有最新代次且响应中的 Version/checksum 仍与当前目标一致时才允许更新 UI。加载期间禁用“下一步”，防止快速开关 Dialog 或切换 Draft 时旧响应覆盖新预览。

用户点击“下一步：测试配置”时，客户端提交当前 `targetSnapshotChecksum`。

### 5.3 Step 2：Test

Test API 扩展请求：

```http
POST /api/domains/:domainId/versions/:draftVersionId/test
Idempotency-Key: <uuid>
Content-Type: application/json

{ "expectedSnapshotChecksum": "..." }
```

服务端创建 Test Deployment 前必须确认：

- Version 仍为该 Domain 当前 Draft。
- 当前 checksum 等于 `expectedSnapshotChecksum`。
- 不相等返回 `409 DRAFT_CHANGED`，Dialog 回到 Diff 并重新加载。

Test Deployment 的 `input_json` 保存 `expectedSnapshotChecksum`。Runner 领取任务时再次比较，避免排队期间 Draft 被原位更新。Test 成功后向导保存：

```ts
type PublishPreflight = {
  testDeploymentId: string;
  versionId: string;
  snapshotChecksum: string;
};
```

UI 每秒轮询 Test Deployment。失败时停留 Step 2，展示失败步骤、有限日志摘要和“返回编辑”；成功才显示“下一步：确认发布”。重新测试使用新的幂等键。

### 5.4 Step 3：Publish

最终页显示 Domain、目标 vN、checksum 短值、Diff 摘要和 Test 成功时间。发布请求：

```http
POST /api/domains/:domainId/versions/:draftVersionId/deploy
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "expectedSnapshotChecksum": "...",
  "preflightDeploymentId": "..."
}
```

服务端在创建 Deploy Deployment 前验证：

1. preflight 是同 Domain、同 Version 的 `test` Deployment。
2. preflight=`succeeded`。
3. preflight 记录的 checksum 与请求及当前 Draft checksum 三者一致。
4. 目标仍是当前 Draft，且 Domain/Runtime 状态允许发布。

上述校验与 Deployment 插入必须位于同一 SQLite 事务，并把 `expectedSnapshotChecksum`、`preflightDeploymentId` 固化到 Deployment `input_json`。保存 Draft 的事务反向检查同 Version 的非终态 Deploy；两个事务由 SQLite 单写者串行化，保证不会同时出现“发布已领取旧内容、Draft 又成功改写”的窗口。

失败返回 `409 PREFLIGHT_STALE` 或现有业务错误。前端回到 Diff/Test，不静默重测或发布。

preflight 只是 UI 和并发门槛，不能替代发布 Runner 自己的完整 candidate `nginx -t`。Deploy Deployment 仍按现有原子生成、测试、激活、reload、健康检查和最终数据库提交执行。

创建 Deploy Deployment 后关闭 Dialog，并跳转 `/deployments/:deploymentId`。

## 6. API 与共享 Schema 变更汇总

| Method | Path | 变化 |
| --- | --- | --- |
| GET | `/api/logs/history` | 新增 `types=access,error`；过渡期兼容旧 `type` |
| GET | `/api/logs/follow` | 新增 `types=access,error`；cursor/filter hash 使用规范化数组 |
| POST | `/api/domains/:id/versions` | 同路径；最新 Draft 改为 CAS 原位更新，响应增加 `mode` |
| GET | `/api/domains/:id/versions/:versionId/publish-preview` | 新增发布向导聚合 Diff；支持首次发布 empty baseline |
| POST | `/api/domains/:id/versions/:versionId/test` | body 增加 `expectedSnapshotChecksum` |
| POST | `/api/domains/:id/versions/:versionId/deploy` | body 增加 checksum 与 `preflightDeploymentId` |

共享 Schema 新增/调整：

- `logTypeSchema`、`logTypesSchema`
- `logColumnIdSchema`、`logColumnPreferenceSchema`
- `saveDraftResponseSchema`（若项目继续只为输入使用 Zod，则至少保持 TypeScript 响应类型统一）
- `publishPreviewResponseSchema`
- `testVersionInputSchema`
- `deployVersionInputSchema`

## 7. 迁移与兼容策略

### 7.1 数据迁移

1. 为 `config_versions` 增加 nullable `updated_at`。
2. 用 `created_at` 回填全部行。
3. 重建/收紧为 `NOT NULL`（按 SQLite migration 能力采用新表复制或保持应用级非空约束）。
4. 创建每 Domain 单 Draft 的部分唯一索引；创建前检查现存重复 Draft，若存在则停止迁移并报告 Domain ID，不自动删除版本。

### 7.2 API 过渡

- 日志 API 在一个开发阶段内兼容旧 `type`；新 UI 上线后删除兼容前必须确认无其他客户端。
- Version 保存路径不变，旧客户端仍能保存；它会收到同一 version number 的新 checksum。前端必须始终采用响应中的 version/checksum，不能本地自增版本号。
- Test/Deploy 新 body 上线后不再允许空 body；同时更新全部 Overview/History/Diff/Tab 发布入口，避免绕过向导。

### 7.3 本地列偏好

偏好不做数据库迁移。读取失败、未知 `schemaVersion`、空列或重复列时删除该 key 并回退默认值。用户清理浏览器数据只会丢失展示偏好，不影响日志和服务端配置。

## 8. 安全与一致性要求

- Draft 原位更新必须保留 `If-Match` 和数据库事务，不能改成 last-write-wins。
- Test 和 Deploy 都绑定 checksum，避免 Draft ID 稳定后产生 TOCTOU 发布。
- 非终态 Deploy 必须暂时阻止目标 Draft 保存；不能只在 Runner 开始时比较一次 checksum。
- 发布 Runner 必须从 Deployment 固化的 Version/checksum 读取并复核数据库，不能只按 `draft_version_id` 查“最新内容”。
- Diff/日志列只渲染纯文本；任何 raw/JSON/Nginx 内容不得使用 `dangerouslySetInnerHTML`。
- 日志类型和显示字段都来自枚举白名单，不接受请求提供文件路径或 Nginx variable。
- Clear button、列排序、Diff 状态同时提供文本/图标/键盘操作，满足现有可访问性规则。

## 9. 测试与验收标准

### 9.1 日志

- 实时关闭时修改筛选不发请求，点击查询后只更新历史结果。
- 实时开启时修改每个筛选项只重连实时流，不触发历史 API，也不清空历史记录。
- 连续输入 Keyword 只在 250 ms debounce 后建立一个新流；旧流被 abort。
- Method Clear 在实时/历史两种模式分别遵循对应生效规则。
- 暂停期间修改筛选会重连实时流且保持暂停；新记录只进入 paused buffer；关闭实时会清空该 buffer 并退出暂停。
- 实时开启时主按钮显示“刷新历史”，且请求仍使用 `historyFilters`；实时筛选不得污染历史 cursor。
- 日志类型至少一项；Access、Error、两者组合都能历史查询和实时 follow。
- Domain/全局列偏好独立持久化，刷新恢复顺序；损坏 localStorage 自动回退。
- 字段缺失、Error/Access 不适用和 Unparsed 行都不会导致渲染异常或丢行；Unparsed 行全文只出现在 `raw`，结构化列为 `-`。
- Method Clear、列上移/下移和 Diff Tab 可全程键盘操作，图标按钮具有明确 `aria-label`。

### 9.2 Draft

- v1 Draft 连续保存仍为 v1、ID 不变、checksum/updatedAt 更新。
- 同一 Draft 连续保存 5 次后数据库仍只有该一行和同一 version number；`created_at` 不变，`updated_at` 随有效保存推进。
- 首次发布后再次编辑创建 v2 Draft；v1 bytes/checksum 永不改变。
- 两个并发客户端以同一旧 checksum 保存时只有一个成功，另一个返回 `VERSION_CONFLICT`。
- 无变化保存不更新 snapshot，不创建版本。
- 同一 Domain 的并发 Draft 创建不会产生两个 Draft 或 orphan Version。

### 9.3 发布向导

- 所有可编辑 Tab 显示同一个发布入口；Logs/History 不显示。
- 首次发布能展示 empty → v1 Diff。
- Added/Removed/Changed 同时使用颜色、文本和图标；小屏可阅读。
- 在系统高对比度和色觉模拟下，Added/Removed/Changed 仍可通过 `+`、`-`、`Changed` 文本或图标区分。
- Draft 在 Diff 后变化，Test 返回 `DRAFT_CHANGED`。
- Draft 在 Test 成功后变化，Deploy 返回 `PREFLIGHT_STALE`。
- Deploy 已创建后立即保存返回 `DRAFT_DEPLOYMENT_RUNNING`；Deploy 标记失败后再次保存成功并返回 `mode:"updated"`。
- 进程中断后，遗留 `running` Deploy 被恢复为终态失败；可恢复的 `queued` Deploy 重新入队，不可恢复者进入终态，均不会永久锁死 Draft。
- Test 失败不能进入发布；成功后才能创建 Deploy Deployment。
- 即使 preflight 成功，发布 Runner 的 candidate `nginx -t` 失败仍不得改变 Active Version。
- 双击最终发布使用同一幂等键，只创建一个 Deployment。

## 10. 建议实施顺序

1. 增加 Draft migration 与 publish-preview，并验证首次发布空基线。
2. 实现 SaveDraft CAS 更新和共享 `PublishDomainDialog`，先接入 Overview。
3. 为全部 Test/Deploy 与旧发布入口补齐 expected checksum/preflight 校验，确认不存在绕过路径。
4. 让 Routes、SSL、Headers、Advanced 共用 `DomainPageActions` 和发布向导。
5. 实现日志历史/实时状态机、多选日志类型、Method Clear 与两类页面列偏好。
6. 完成 API、组件和 Docker E2E 回归后，以独立文档提交同步：更新 `TECHNICAL_DESIGN.md` 中“每次保存新建版本”的冲突段落；更新 PRD 的可编辑 Tab/发布向导与日志类型；更新 `review.md` 已关闭决策，注明 Draft 改为原位保存、以最终 checksum/Deployment 审计替代逐次保存历史；最后删除日志旧 `type` 兼容。

## 11. 明确不做

- 不记录每一次 Draft 保存的审计事件。
- 不提供 Draft “另存为”或分支能力；每个 Domain 只有一个 Draft，并行编辑新方案前必须先发布或放弃当前 Draft。
- 不把日志列偏好写入 SQLite，也不跨设备同步。
- 日志列偏好不支持条件高亮、单元格格式规则或行操作。
- 不允许跳过 Test 步骤直接从任意 Tab 发布。
- 不因为 preflight 已成功而删除发布 Runner 的 `nginx -t`。
- 不让日志显示字段配置反向修改全局 Nginx `log_format`。

## 12. 评审决策与取舍

| 评审项 | 处理结论 |
| --- | --- |
| DRAFT-1：Deploy 锁恢复 | 接受并细化：遗留 `running` 必须失败；可恢复 `queued` 继续执行，不可恢复者失败，任何路径都不得形成僵尸锁 |
| DRAFT-2：暂停状态 | 接受；补齐暂停中改筛选、关闭实时、重新开启与清屏的状态转移 |
| DRAFT-3：Diff 请求竞态 | 采用纯读 GET + `AbortController`/请求代次；不为 GET 增加幂等键 |
| clarify-1：实时开启后的查询按钮 | 同一主按钮改名为“刷新历史”，明确只使用 `historyFilters` |
| clarify-2：首次发布空基线 | 使用展示层固定文本，不生成虚构 Nginx 配置 |
| clarify-3：Unparsed fallback | 全行进入 `raw`，结构化字段统一为 `-` |
| clarify-4：cursor hash | 历史与实时 cursor 分离签名；实时筛选变化只淘汰实时 cursor |

不保留逐次 Draft 保存历史是有意取舍：避免同一未发布方案产生大量版本噪声，发布边界仍由最终 checksum、Test/Deploy Deployment 和不可变 Active Version 审计。若未来出现合规上的逐次编辑追踪需求，应新增独立 `config_version_events`，不恢复“每次保存创建 Version”。

日志列偏好只影响展示，采用浏览器本地存储可避免引入用户身份、同步 API 和数据库模型；代价是清理浏览器数据或更换设备后偏好丢失，UI 必须明确提示这一点。
