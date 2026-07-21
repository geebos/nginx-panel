# Manager Domain 配置化技术设计

> 状态：定稿修订 **v1.2**（评审 R1–R27 已关闭，待实现）  
> 日期：2026-07-20  
> 关联：`docs/archive/TECHNICAL_DESIGN.md` §2.6、`docs/adr/0001-runtime-config-tree-spike.md`、`docs/review.md`

## 覆盖声明

**本文 + ADR 0001 为管理端 hostname / TLS / root manager 拓扑的现行真相源。**  
`docs/archive/TECHNICAL_DESIGN.md` §2.6 及任何「生产强制 `MANAGER_HOST` + HTTPS + 文件证书」条款，在冲突时以本文为准（supersede）。实现期以本文为准，archive 文档可在后续整包修订中同步。

## 评审回复 v3（2026-07-20）

| 编号 | 结论 | 落点 / 可检索原文短语 |
|---|---|---|
| R21 | 接受 | §6.3 `unconfigured → Create bind`；§9.2 `unconfigured → Create bind`；§12 `无 manager 行 → Create bind` / `status: unconfigured` |
| R22 | 接受 | §8.1 代码块 `reserved =` + `含 draft-only` |
| R23 | 接受 | §5.2 `"bound": true` / `"bound": false` 范例；§7.5 `bound=false` + `local.manager.invalid` |
| R24 | 接受 | §11.1 `tlsOk && rootServesHost` / `直接 active` |
| R25 | 接受 | §12 `对外唯一证书 API` + `/api/settings/manager/certificate/*` |
| R26 | 接受 | §8.2 `已知限制（R26 · 跨 Host 会话）` |
| R27 | 接受 | §6.1 `完全跳过 root 重写`；§10.4 `完全跳过` + `不调用 refreshActiveRoot` |
| R28 | 接受 | 本表落点列为可 `rg` 短语；状态行仅在正文齐后标关闭 |

### 本轮说明

Review v3 核对时正文补丁可能尚未写完（与 Author v2 竞态）。**v1.2 正文现已全部落地**；上表短语可用 `rg` 在 `docs/manager-domain.md` 命中。§10.4 本轮补全为 skip。

## 评审回复 v2（2026-07-20）

| 编号 | 结论 | 落点 / 说明 |
|---|---|---|
| R21–R27 | 接受 | 见 v3 表（正文已齐） |

## 评审回复 v1（2026-07-20）

| 编号 | 结论 | 落点 / 说明 |
|---|---|---|
| R1–R20 | 接受 | 见 v1.1 全文落点（启动契约 A、分 server、Cookie/Origin、verifier、Rebind-only、Setup 时序、tombstone、迁移、API、e2e） |

### v1.1 变更摘要

- 启动契约 A；分 server；Cookie/Origin；Rebind-only；Setup 时序；verifier 过滤；迁移与 e2e 分期。

---

## 1. 目标

将管理面（Manager）从「环境变量写死的 hostname + 文件证书」升级为可配置、可版本化、可回滚的控制面身份，同时保证：

1. 冷启动无需事先准备域名与证书，本地 HTTP 即可进入面板。
2. Manager 流量始终由 **root `nginx.conf`** 承载，不进入 `domains/*.conf` 业务渲染路径。
3. 配置进入 `config_versions`，支持 draft / publish / rollback 与证书激活。
4. 迁移完成后，**不再**依赖 `MANAGER_HOST` / `MANAGER_TLS_*` 作为域名与证书的真相源。
5. 容器重启后仍保留已发布的 manager 绑定与证书（见 §6.1）。

## 2. 定稿决策一览

| 主题 | 结论 |
|---|---|
| 渲染路径 | Manager **只写 root**；不走 `renderDomainConfig` / `domains/*.conf` |
| 冷启动 | 仅当 **无 active runtime** 时，`start.mjs` 写入 bootstrap root；**禁止**用 bootstrap 覆盖已发布 manager 段 |
| 环境变量 | 迁移后不用 `MANAGER_HOST` / `MANAGER_TLS_*` 作为域名与证书真相源；存量升级见 §11.1 |
| 数据模型 | `domains.type = 'domain' \| 'manager'`；全局最多一条未删除 manager |
| 版本 | Manager 配置写入 `config_versions`；publish / rollback / 证书激活据此刷 root |
| 可变字段 | **hostname（primary + aliases）+ SSL/证书**；routes / headers / advanced **不处理** |
| SSL 校验 | Manager **禁止 HTTP-01**；仅 DNS-01（manual / Cloudflare） |
| 本地入口 | **始终保留** `127.0.0.1` 与 `localhost`（第一版不含 `::1`） |
| nginx 拓扑 | **至少两套 HTTP server**：bootstrap 与 bound 分离；禁止单块 `server_name` 并集 + 全局 308 |
| Domains 列表 | **方案 A**：列表不展示 `type=manager`；`GET /api/domains/:id` 对 manager 返回 404 |
| 首次启动 | Setup 设管理员密码时 **可选** 配置 manager 域名（可跳过） |
| 日常入口 | **Settings → Manager** 独立 tab |
| 回滚 | 同实体 **version rollback** |
| 换域名（v1） | **仅同实体 Rebind**（新 version → publish）；多实体 Switch 为非目标 / P4+ |
| 首次绑定（Setup 跳过后） | Settings `PUT`：**无 manager 行则 Create bind**（insert + draft），有则 update draft |
| Reset 标志 | `snapshot.bound: boolean`（用户绑定 publish → true；Reset → false） |
| 启动有 active | `start.mjs` **完全跳过** root 重写；log-format 只走 worker deploy |

## 3. 现状与问题

### 3.1 当前行为

- 生产强制 `MANAGER_HOST` + `MANAGER_URL`（HTTPS），hostname 必须一致。
- `docker/nginx/nginx.conf.template` 写死 manager server：`8080` 整站 308 → HTTPS；`8443` 上 UI + `/api/` 反代 8787；TLS 来自 `MANAGER_TLS_*` 或启动时自签；`/api/` 写死 `X-Forwarded-Proto https`。
- `start.mjs` 每次启动渲染模板并 `refreshActiveRoot`（仅保留 log-format 标记区）——**会冲掉**面板写入的 root 变更。
- `verifyRuntime` / deploy 对所有带 `activeVersionId` 的 domain 期望 `domains/<id>.conf`。
- `assertManagerHostnameAvailable` **禁止**任何 domain 占用 `MANAGER_HOST`（e2e 覆盖 409）。
- Cookie：`secure: APP_ENV !== "development"`；Origin：production 仅认单个 `MANAGER_URL` origin。
- `hostnameSchema` 不接受 `localhost` / IP 字面量；`domains.primary_hostname` 全局 UNIQUE 不区分 soft-delete。

### 3.2 痛点

- 域名与证书无法在面板内管理与回滚。
- 无 SSL 冷启动与当前 production 契约冲突；Secure Cookie 导致 HTTP 登录失败。
- Manager 若有 version 却不写 conf，会与 verifier 冲突；若写 conf 又与 root 双写冲突。
- 重启冲掉已发布 root。

## 4. 架构

### 4.1 总览（分 server）

```text
Browser
  │
  ├─ http://127.0.0.1 | localhost     → bootstrap HTTP server（永不 308）
  └─ http(s)://user-manager-host      → bound HTTP（可 308）/ bound SSL
        │
        ▼
  root nginx.conf
        ├─ server bootstrap-http   server_name 127.0.0.1 localhost;  listen 8080;
        │     location /api/ → 8787  (X-Forwarded-Proto $scheme)
        │     location /     → UI
        ├─ server bound-http       server_name <user hosts>; listen 8080;
        │     [no cert] UI+API 同模板
        │     [has cert + forceHttps] return 308 https://$host$request_uri
        ├─ server bound-ssl        server_name <user hosts>; listen 8443 ssl;  (仅有证时)
        │     UI+API + 证书路径
        ├─ default_server / internal-health（现有语义保留）
        └─ include domains/*.conf   (仅 type=domain)
```

**禁止**：把 bootstrap 名与用户域名放进**同一个**带 `return 308 https://...` 的 `server` 块。

### 4.2 真相源分层

| 层级 | 内容 | 来源 |
|---|---|---|
| Bootstrap hosts | `127.0.0.1`, `localhost` | 运行时常量，**不进** version snapshot |
| Manager 绑定 | primaryHostname + aliases | `type=manager` 的 **active** version snapshot |
| Manager SSL | enabled、validation、certificateId | 同上；证书文件由 ACME 落盘 |
| 业务 Domain | 现有 DomainConfig | `type=domain` + versions → `domains/<id>.conf` |
| Root 文件 | 已发布完整 nginx.conf | active revision；**启动不得用 bootstrap 覆盖 manager 段**（§6.1） |

渲染输入（逻辑并集，**物理上分 server**）：

```text
bootstrapHosts = {127.0.0.1, localhost}
userHostnames  = (snapshot?.bound === true) ? [primary, ...aliases] : ∅
```

### 4.3 为何只写 root

- Manager 的 location 是控制面固定模板（UI + API），不是用户可编 routes。
- 与 ADR 0001「bootstrap/manager 住在 root」一致；manager 变更走 **root refresh**。
- 避免与 `include domains/*.conf` 中同名 `server_name` 冲突。

## 5. 数据模型

### 5.1 `domains.type`

```text
domains
  + type TEXT NOT NULL DEFAULT 'domain'   -- 'domain' | 'manager'
```

```sql
CREATE UNIQUE INDEX domains_one_manager
  ON domains(type)
  WHERE type = 'manager' AND deleted_at IS NULL;
```

### 5.2 Version snapshot（manager）

使用 **`managerConfigSchema`**：在 `domainConfigSchema` 之上（或并行）做 superRefine / 规范化：

- 强制 `routes = []`、`headers = []`、`advanced.serverSnippet = ""`；
- **`bound: boolean`（必填）**：用户域名已绑定且应对外渲染 bound server 时为 `true`；Reset / 未绑定占位为 `false`；
- `ssl.validation.method` ∈ { dns-01 的 manual / cloudflare }，**禁止** `http-01`；
- `ssl.email`：enabled 时必填合法 email；disabled 时允许 `""`；
- `ssl.autoRenew` 默认 `true`；`forceHttps` 默认 `true`（仅作用于 **bound** server，见 §8.3）；
- 用户 hostname 仍走业务 `hostnameSchema`（域名形态，不含 IP）；
- **禁止**用户将 primary/aliases 设为 `local.manager.invalid`（Reset 占位保留名）。

**规范 snapshot 范例（首次绑定、ssl 关）：**

```json
{
  "schemaVersion": 1,
  "bound": true,
  "primaryHostname": "panel.example.com",
  "aliases": [],
  "routes": [],
  "headers": [],
  "ssl": {
    "enabled": false,
    "provider": "letsencrypt",
    "environment": "production",
    "email": "",
    "autoRenew": true,
    "forceHttps": true,
    "validation": { "method": "dns-01", "provider": "manual" }
  },
  "advanced": { "serverSnippet": "" }
}
```

**Reset 后 snapshot 范例：**

```json
{
  "schemaVersion": 1,
  "bound": false,
  "primaryHostname": "local.manager.invalid",
  "aliases": [],
  "routes": [],
  "headers": [],
  "ssl": {
    "enabled": false,
    "provider": "letsencrypt",
    "environment": "production",
    "email": "",
    "autoRenew": true,
    "forceHttps": true,
    "validation": { "method": "dns-01", "provider": "manual" }
  },
  "advanced": { "serverSnippet": "" }
}
```

渲染：`userHostnames = bound ? [primary, ...aliases] : []`。  
**Bootstrap IP/localhost 不写入 snapshot**，由 root 渲染 runtime 注入。

### 5.3 列表、API 与过滤

| 面 | 规则 |
|---|---|
| Domains 列表 / 默认枚举 | `WHERE type = 'domain' AND deleted_at IS NULL` |
| Dashboard 业务统计 | 排除 manager |
| 日志 domain 选择器 | 排除 manager（manager 访问日志可另议，默认不混入业务列表） |
| 证书总览 / ACME 订单列表（若按 domain 扫） | Settings Manager 展示 manager 订单；全局证书列表 **排除或单独分区**，避免当业务站 |
| 深链 `/domains/*?id=`、UI DomainTabs | 不服务于 manager |
| `GET /api/domains/:id` | 若目标 `type=manager` → **404** `DOMAIN_NOT_FOUND`（不 308，避免泄露） |
| `GET /api/settings/manager` | 唯一对外读模型（含内部 domainId、versions 摘要） |
| verify / manifest.domains / rebuild 枚举 conf | **`type = 'domain'` only** |

### 5.4 Verifier / manifest 不变量

- 期望存在的 conf 文件集合 = 所有 `type=domain` 且 `activeVersionId != null` 的 domain。
- Manager **永不**出现在 `manifest.domains` 的 conf 列表中。
- Manager 身份进入 root 渲染输入；manifest 可增加可选 `rootInputs`（如 managerVersionId、managerChecksum、certificateId）供漂移检测；至少 `rootConfigChecksum` 覆盖完整 root。
- 任意会重渲 root 的路径（manager publish、log-settings、rebuild_active、业务 domain publish 若重写 root）**必须**合并：当前 manager active snapshot（若有）+ bootstrapHosts + 证书路径。

### 5.5 Soft-delete 与 `primary_hostname` UNIQUE

`domains.primary_hostname` 现状全局 UNIQUE 且不区分 `deleted_at`，会导致软删业务域后 hostname 仍占坑，manager 无法 Rebind 同名。

**v1 策略（tombstone）：**

软删 domain 时在同一事务：

1. 删除其 `domain_aliases` 全部行；
2. 将 `primary_hostname` / `display_hostname` 改为 tombstone，例如 `deleted-<uuid>.invalid`（保证唯一且不可被用户选为合法 hostname）；
3. 再设 `deleted_at`。

冲突检测与 hostname 可用性只针对 `deleted_at IS NULL`。  
（备选 partial unique `WHERE deleted_at IS NULL` 可作为后续 migration 优化，v1 以 tombstone 为准，避免一次改过多约束。）

## 6. Bootstrap 与生命周期

### 6.1 进程启动契约（R1 方案 A）

**单一真相源：**

| 状态 | 启动行为 |
|---|---|
| **无** `active` symlink / 首次 bootstrap | `start.mjs` 用 bootstrap 模板写 root（仅 bootstrapHosts，无 SSL，无 `MANAGER_*` 强制）并建立 active |
| **已有** active | **`start.mjs` 完全跳过 root 重写**（不调用会整文件替换的 `refreshActiveRoot`）。现状 `refreshActiveRoot` 只能整文件替换并保留 log-format，**做不到**只改 log-format 而不动 manager 段；log-format 变更 **只走** worker `log-settings` deploy。 |
| Worker 启动后 | 读 SQLite：若存在 active manager version，计算期望 root manager 指纹；与磁盘 active root 漂移 → **enqueue root rebuild**（不阻塞进程启动，但 runtime 可标 degraded 直至 rebuild 成功，策略与现有 `verifyRuntime` 对齐） |

失败降级：

- DB 不可读：保持现有 active root，记录 error；不回退冲掉配置。
- Rebuild 失败：保留上一 active；告警。

**可不设置** `MANAGER_HOST` / `MANAGER_URL` / `MANAGER_TLS_*` 仍能完成 P0 冷启动（greenfield）。

### 6.2 首次 Setup（可选 Manager）

扩展 `POST /api/setup/admin`：

```text
必填: username, password
可选: managerPrimaryHostname?, managerAliases?
```

**锁定时序（R8）：**

1. 同一事务：创建管理员；若提供域名则 insert `type=manager` + `config_versions` **v1 status=draft**（规范化 snapshot，`bound=true`，`ssl.enabled=false`）。**此时不设 `activeVersionId`。**
2. 事务提交后：若创建了 manager draft，enqueue **root deploy**（manager 分支）。
3. **仅 deploy 成功** 后将 v1 标为 active 并设置 `activeVersionId`（与业务 domain publish 一致）。
4. Deploy 失败：manager 行可保留 draft，Settings 显示「绑定中 / 发布失败可重试」；**不得**出现双 manager；列表仍不展示 manager。
5. Setup 跳过 manager：不建行；root 保持 bootstrap。

**Setup 不包含 SSL / DNS-01 / Cloudflare。**

### 6.3 状态机与首次绑定（R21）

```text
start.mjs
  ├─ no active → write bootstrap root
  └─ has active → skip root rewrite entirely; worker may rebuild if drift
  →
Setup 跳过 manager          Setup 填写域名
  │                           │
  │  status=unconfigured      → insert manager + draft v1 (bound=true)
  │                           → enqueue root deploy → success ⇒ active
  └───────────┬───────────────┘
              ▼
    Settings → Manager
      · unconfigured → Create bind（PUT 创建行+draft）→ deploy → bound
      · bound → Rebind hostname → draft → test(root) → deploy(root)
      · SSL DNS-01 → order → activation → root deploy
      · Rollback version → root deploy
      · Reset to local only (bound=false)
              │
              ▼
    invariant:
      bootstrap HTTP server 始终存在
      reserved hostnames 见 §8.1（含 draft manager）
      type=manager 未删除行全局 ≤ 1
      manager 不在 domains/*.conf / manifest.domains conf 列表
```

**Create bind（无 manager 行）：** 与 Setup 同 schema；`PUT /api/settings/manager` 检测无行则 insert `type=manager` + draft（`bound=true`），再按 §6.2 时序 enqueue deploy。

## 7. 更新、发布、回滚与 Rebind

### 7.1 更新逻辑分流

```text
if domain.type === 'manager':
  - 经 managerConfigSchema 规范化
  - 白名单：primaryHostname, aliases, ssl（certificateId 由系统写入）
  - 覆盖 routes / headers / advanced
  - 拒绝 http-01
  - 更新 domain_aliases / primary_hostname 列
else:
  现有业务逻辑
```

对外写入口见 §12（Settings API → 内部 domainId + versions）。

### 7.2 Publish / 证书激活 / Rollback（apply）

```text
if domain.type === 'manager':
  - 不写 domains/<id>.conf；不把 manager 列入 conf 集合校验
  - 用目标 version + bootstrapHosts + 证书路径渲染 root（§10.1 分段）
  - 完整树候选 + nginx -t + 原子切 active
  - previousVersionId 等支持 rollback
else:
  现有 domains/*.conf 路径
  - 若该路径会重渲 root：必须合并当前 manager active snapshot
```

### 7.3 同实体回滚

```text
manager (唯一行)
  v3 active  ← 坏变更
  v1
→ rollback to v1 → root deploy
```

### 7.4 换域名（v1 = Rebind only）

v1 **只支持同实体 Rebind**：

1. 校验新 hostname 不得占用 §8.1 `reserved` 中他人已占用项（含其它 domain、其它 manager draft/active、bootstrapHosts、占位保留名）；可改为自身当前 primary/aliases。
2. draft → manager `test`（root 预检）→ deploy → 只刷 root。
3. 回滚用 version rollback。

**多实体 Switch / 档案制 / promote 业务 domain：非目标（§15），P4+ 另议。**

禁止将业务 domain 完整 snapshot（含 routes）标成 manager。

### 7.5 删除 / 禁用 / Reset

| 操作 | 规则 |
|---|---|
| Delete manager | **禁止** |
| Disable manager | **禁止**；runner 对 manager **强制 `enabled: true`** 投影 |
| Reset to local only | 新建 draft：`bound=false`，`primaryHostname=local.manager.invalid`，`aliases=[]`，`ssl.enabled=false`，模板字段清空 → publish 成功后 root **仅** bootstrap HTTP；历史 versions **保留**；证书文件 **留盘**（不在 Reset 时 revoke ACME） |

**占位名 `local.manager.invalid`：** 仅满足 `primary_hostname NOT NULL` / UNIQUE；**永不**进入 nginx `server_name`；**禁止**用户 Rebind 到该名（§8.1）。渲染唯一依据是 `snapshot.bound`（R23）。

### 7.6 API / Runner 分流表（R10）

| 操作 | Manager 行为 | 业务 Domain 行为 |
|---|---|---|
| save draft | `managerConfigSchema`；白名单字段 | `domainConfigSchema` |
| test / preflight | 生成候选 **root**（含 manager 段 + 全部业务 conf）并 `nginx -t` | 候选含目标 domain conf + 当前 root（root 须含 manager） |
| deploy / publish | 原子 root refresh；不写 manager conf 文件 | 写/更新 `domains/<id>.conf`；root 若重渲则合并 manager |
| rollback | 切 activeVersion + root deploy | 现有 rollback + conf |
| cert activate | version pending → deploy **manager 分支**（root-only） | 现有 certificate deployment |
| nginx preview | 返回 root 中 manager 相关 server 片段（或完整 root 预览） | `renderDomainPreview` |
| enable/disable toggle | **拒绝** | 现有逻辑 |

## 8. 冲突与安全

### 8.1 Hostname 冲突（与 UNIQUE / assert 一致）

**保留集（任一方 create/draft 均不可占用他人已占用名）：**

```text
reserved =
  bootstrapHosts
  ∪ 所有 deleted_at IS NULL 的 type=manager 的 primary+aliases
      （含 draft-only、尚未 active；排除 bound=false 时的占位名 local.manager.invalid）
  ∪ 所有 deleted_at IS NULL 的 type=domain 的 primary+aliases
  ∪ { local.manager.invalid }   // 系统保留，用户不可选
```

- 与 `assertHostnamesAvailable` / 列 UNIQUE 语义对齐：**draft 已占坑**，业务域不能抢 manager draft 域名。
- Manager Create bind / Rebind 不得占用其它未删除 domain 的 primary/aliases。
- Soft-delete tombstone（§5.5）后原 hostname 释放回可用池。

### 8.2 Cookie / Origin（锁死）

**Cookie `Secure`（R4）：**

```text
secure = (effectiveRequestScheme === "https")
```

- `effectiveRequestScheme`：优先信任 **本机 nginx 注入** 的 `X-Forwarded-Proto`（模板必须用 `$scheme`，禁止写死 `https`）；否则看连接 scheme。
- 同一浏览器在 HTTP 与 HTTPS 入口可能持有不同 Secure 属性的会话 cookie：可接受；文档不要求跨 scheme 单会话。
- e2e：HTTP bootstrap login / setup 必须成功收到会话。

**Allowed Origin（R5）：**

```text
bootstrapHosts = ["127.0.0.1", "localhost"]
userHosts = active manager snapshot hostnames (if any)

function originsFor(host, schemes, ports):
  // ports: published host ports — default http 80, https 443;
  // 若部署使用非标准映射，从配置/请求 Host 推导，单测覆盖 :8080 映射场景可选

allowedOrigins =
  originsFor(bootstrapHosts, ["http"], [80, …]) ∪
  originsFor(userHosts, ["http", "https"], [80, 443, …])

requireSameOrigin (mutating):
  if no Origin header: keep existing non-browser policy
  else: allow iff parse(Origin).origin ∈ allowedOrigins
```

Development 可继续放宽 localhost 环回。删除 production 对单一 `MANAGER_URL` 的依赖。

**已知限制（R26 · 跨 Host 会话）：**  
Cookie 为 host-only（不设 `Domain=` 父域）。在 `http://127.0.0.1` 登录的会话 **不会** 自动带给 `https://panel.example.com`（反之亦然）。各 Host 需分别登录。v1 **不**放宽 cookie Domain（安全上不建议）。

### 8.3 HTTP vs HTTPS 分 server（R3）

| Server | server_name | listen | 行为 |
|---|---|---|---|
| bootstrap-http | `127.0.0.1` `localhost` | 8080 | UI+API；**永不** 308 |
| bound-http | user hosts | 8080 | 无证：UI+API；有证且 forceHttps：`return 308 https://$host$request_uri` |
| bound-ssl | user hosts | 8443 ssl | 仅有可用证书时；UI+API |

### 8.4 为何禁 HTTP-01

控制面不应依赖 HTTP 挑战环；DNS-01 不依赖 manager HTTP 挑战路径。

## 9. UI

### 9.1 Setup

- 用户名/密码必填；可选 Manager 域名折叠区；不展示 SSL。

### 9.2 Settings → Manager

路径：`/settings/manager`。Tabs 增加 Manager（i18n）。

| 区块 | 能力 |
|---|---|
| 状态 | `unconfigured` / `draft`（发布中或失败可重试）/ `bound` / SSL 状态；本地入口说明 |
| 绑定域名 | **unconfigured → Create bind**；已有行 → Rebind；均走 draft → publish |
| 证书 | HTTPS、DNS-01 only、订单 |
| 版本历史 | 列表、rollback（unconfigured 时隐藏） |
| Reset | Reset to local only（确认；`bound` 后可用） |

无 routes / headers / advanced；无 Switch 按钮（v1）。

### 9.3 Domains

列表与 create 不承担 manager 初始化；不提供「勾选为 manager」。

## 10. 渲染与部署

### 10.1 `RenderManagerRootInput` 与模板分段

```ts
type RenderManagerRootInput = {
  bootstrapHosts: string[];          // ["127.0.0.1","localhost"]
  userHostnames: string[];           // bound ? snapshot hosts : []; may be []
  listeners: { http: number; https: number }; // 8080 / 8443
  tls?: { fullchainPath: string; privateKeyPath: string };
  forceHttpsOnBound: boolean;       // from snapshot.ssl.forceHttps when tls present
  uiRoot: string;                    // e.g. /opt/nginx-manager/ui
  apiUpstream: string;               // e.g. http://127.0.0.1:8787
};
```

模板分段（逻辑名）：

1. `http` 上下文：map、log-format 标记区、temp paths  
2. `default_server` HTTP/HTTPS（现有 444 语义可保留）  
3. **bootstrap-http** manager  
4. **bound-http** manager（`userHostnames` 非空时）  
5. **bound-ssl** manager（`tls` 有值时）  
6. `internal-health`  
7. `include domains/*.conf`  

`location /api/`：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

禁止写死 `https`。

**P0 删除/放宽的强制校验点：**

- `start.mjs`：不再 require `MANAGER_HOST`/`MANAGER_URL` HTTPS 匹配（greenfield）。
- `validateRuntimeEnv`：development 与「无 manager TLS 文件」可启动；TLS 文件校验改为「若配置了文件证书则校验」或迁移期兼容。
- `renderRuntimeRoot`：不再 require 三项 env 做 replace；改为 `RenderManagerRootInput`。
- 默认不再自签生成 manager 证书。

### 10.2 log-format 标记

保留 `# nginx-manager:log-format:start|end` 与 `preserveManagedLogFormat`。

### 10.3 监听端口

容器 **8080 / 8443**；Docker 映射 80/443。

### 10.4 Root 重渲调用方

| 调用方 | 必须合并 manager active？ |
|---|---|
| manager deploy / rollback / cert activate | 是（目标 version） |
| log-settings deploy | 是（当前 active manager） |
| rebuild_active | 是 |
| 业务 domain deploy（若重写 root） | 是 |
| start.mjs 无 active bootstrap | 否（user user hosts） |
| start.mjs 已有 active | **完全跳过** root 重写（不调用 `refreshActiveRoot`） |

## 11. 环境变量与迁移

### 11.1 存量升级（R11 / R24）

首次启动新版本 worker（或 migration job）：

```text
if 不存在 type=manager 行 AND env.MANAGER_HOST 非空:
  primary = normalize(MANAGER_HOST)
  tlsOk = MANAGER_TLS 文件可读且校验通过（SAN 覆盖 primary）
  rootServesHost = active root 已含该 host 的 manager server（旧模板）
  创建 type=manager + v1，bound=true, primaryHostname=primary
  if tlsOk && rootServesHost:
    v1 直接 active（避免升级空窗）；记录 checksum；可选 enqueue rebuild 对齐新分段模板
  else:
    v1 draft + 立即 enqueue root rebuild；成功后 active
  ssl.enabled = tlsOk
  文件证书：过渡 external/file 态；目标 P3 迁 ACME 落盘
else if 无 manager 且无 MANAGER_HOST:
  保持 bootstrap only（greenfield）
```

文档与 compose：升级后若未设 `MANAGER_HOST` 且库中无 manager，则仅 localhost 可进，需 Settings **Create bind**。

### 11.2 变量角色与废弃

| 变量 | 迁移后 |
|---|---|
| `MANAGER_HOST` | 仅升级种子；非运行时真相源 |
| `MANAGER_URL` | 不再作 Origin 唯一来源；可删 |
| `MANAGER_TLS_*` | 升级过渡 / 紧急覆盖；P3 后非必需 |
| `reload-manager-tls` deployment | P3 后 **废弃** 或降为「紧急文件覆盖」高级操作；Diagnostics 改为展示 active manager snapshot + cert 状态 |

第一版 bootstrap：**仅** `127.0.0.1` + `localhost`。  
`::1`、`MANAGER_EXTRA_HOSTS`、容器 LAN 探测：**非目标**。

## 12. API 草案（收敛）

**v1 对外只文档化 Settings 前缀（R14 / R25）。** Worker 内部可持有 manager `domainId` 并复用 versions/certificate 实现，**不**对 UI/公开文档暴露 domain 路径。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/setup/admin` | 可选 manager 字段；§6.2 时序 |
| GET | `/api/settings/manager` | `status: unconfigured \| draft \| bound \| …`；config；versions 摘要；本地入口；publish 是否可点 |
| PUT | `/api/settings/manager` | **无 manager 行 → Create bind**（insert + draft，`bound=true`）；有行 → update draft。body：hostname/aliases/ssl 子集 |
| POST | `/api/settings/manager/publish` | 内部 preflight + deploy（root 分支）；UI 不暴露 domainId |
| POST | `/api/settings/manager/rollback` | 同上 |
| * | `/api/settings/manager/certificate/*` | 对外唯一证书 API；禁 HTTP-01；内部可转 domainId 实现 |

校验逻辑集中在 worker manager 分支，避免双份 schema。

## 13. 实现分期

| 阶段 | 范围 | 验收 |
|---|---|---|
| **P0** | Bootstrap HTTP 分 server；启动契约 A；去掉 MANAGER_* 硬依赖与自签；Cookie/Origin/`$scheme`；无 active 启动路径 | 无 env 域名证书可起；`http://127.0.0.1` setup+login；重启不要求 env |
| **P1** | `type`+tombstone；managerConfigSchema；verifier 过滤；root-only deploy；漂移 rebuild | publish 改 bound `server_name`；重启后仍在（R1）；conf 无 manager 文件 |
| **P2** | Settings → Manager；Setup 可选域名；rollback UI；Reset | 面板完成绑定/回滚/Reset |
| **P3** | DNS-01 挂 bound-ssl；废弃 reload-manager-tls 主路径；升级种子 | 公网 HTTPS + 本地 HTTP 并存 |
| **P4+** | e2e 全表；compose 文档；可选 Switch 另案 | 见 §14 |

## 14. 测试要点（按阶段）

### P0

- 无 `MANAGER_HOST`/`MANAGER_TLS_*` 容器启动成功。
- HTTP bootstrap setup + login，会话 cookie 非 Secure（或 Secure=false）可用。
- Origin：从 `http://127.0.0.1` 的 mutating 请求通过；错误 Origin 403。
- root 含 bootstrap-http；无强制 8080→https 对本地 host。
- `/api/` 转发 `X-Forwarded-Proto` 为 http。

### P1

- manager draft 拒绝 routes/headers/advanced/http-01。
- publish 后 root 出现 bound-http；`domains/*.conf` 无 manager id 文件。
- verifier / rebuild 不因缺 manager conf 失败。
- 业务 domain 占用 manager/bootstrap host → 409。
- **重启容器后** bound `server_name` 仍在（不被 bootstrap 冲掉）。
- soft-delete 业务域后 tombstone，原 hostname 可被 manager Rebind。

### P2

- Setup 带/不带 manager；失败 deploy 可重试且无双 manager。
- Settings Rebind + rollback。
- Reset to local only 后仅 bootstrap server；历史可 rollback。
- 列表/dashboard/证书总览不把 manager 当业务站；`GET /api/domains/:managerId` → 404。

### P3

- DNS-01 签发后 bound-ssl 工作；bound-http 308 仅用户域名。
- `127.0.0.1` HTTP 仍可登录。
- 存量：`MANAGER_HOST` 种子创建 manager 行并对齐 root。

### 回归

- 替换 `production-smoke` 中「managerHost 建 domain → 409」为新冲突矩阵与上述条目。

## 15. 非目标

- 多个同时 active 的 manager domain。
- 用户编辑 manager 的 routes / headers / advanced。
- Manager 使用 HTTP-01。
- 将业务 domain 整包 promote 为 manager。
- **多实体 Switch / 档案制（P4+ 另案）。**
- 容器内自动探测 LAN/bridge IP；`::1`；`MANAGER_EXTRA_HOSTS`（第一版）。
- P3 后继续以 env 文件证书为证书真相源（紧急覆盖除外）。
- Tauri/桌面端特殊拓扑（另文）。

## 16. 默认实现假设

1. v1 换域名 = **同实体 Rebind only**；Setup 跳过后首次绑定 = **Create bind**（§6.3）。
2. 不自动 promote 业务 snapshot。
3. Setup 仅可选域名；证书只在 Settings → Manager（§12 前缀）。
4. Manager 禁止 delete/disable；Reset 用 `bound=false` + 占位 hostname（§7.5）。
5. 不强制 greenfield 启动 seed manager 行；存量按 §11.1：`tlsOk && rootServesHost` → 直接 active，否则 draft+rebuild。
6. 启动契约 **方案 A**；有 active 时 start.mjs **完全跳过** root 重写（§6.1）。
7. Cookie Secure 跟请求 scheme；Origin 为 bootstrap ∪ bound 集合；**跨 Host 不共享会话**（§8.2）。
8. Hostname 冲突含 **draft manager**（§8.1）。

## 17. 关键代码锚点（现状）

| 区域 | 路径 |
|---|---|
| Domain schema | `src/shared/schemas/domain.ts` |
| Config versions | `src/shared/schemas/config-version.ts` |
| Draft 保存 | `src/worker/lib/domain/draft-version.ts` |
| Hostname 冲突 | `src/worker/lib/domain/validation.ts` |
| Root / domain 渲染 | `src/worker/lib/nginx/config.ts` |
| Deploy / root | `src/worker/lib/deployment/runner.ts` |
| Runtime verify | `src/worker/lib/runtime/verifier.ts`（及 root-refresh） |
| Manager TLS | `src/worker/lib/runtime/manager-tls.ts` |
| MANAGER_URL | `src/worker/lib/runtime/env.ts` |
| Cookie / Origin | `src/worker/lib/auth.ts`, `src/worker/middleware/auth.ts` |
| Setup | `src/worker/routes/auth.ts`, `src/shared/schemas/auth.ts` |
| Bootstrap / 模板 | `docker/scripts/start.mjs`, `docker/nginx/nginx.conf.template` |
| Settings tabs | `src/components/pages/settings/tabs.tsx` |
| E2E | `docker/e2e/production-smoke.mjs` |

## 18. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-07-20 | 初版定稿 |
| 2026-07-20 | v1.1：关闭 R1–R20 |
| 2026-07-20 | v1.2：关闭 R21–R27（Create bind、冲突含 draft、`bound` 标志、升级种子、证书 API 前缀、跨 Host 会话、start.mjs skip） |
| 2026-07-20 | v1.2 微补：§6.2 Setup 显式 `bound=true`；§7.4 Rebind 校验对齐 §8.1 reserved（Review v4 实现期对齐项） |
