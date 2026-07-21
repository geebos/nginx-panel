# Code Review: `dev/manager-domain`

> 审查对象：`dev/manager-domain` vs `main`  
> 日期：2026-07-20  
> 模式：`/code-review` max effort（10 finder angles → 1-vote verify → gap sweep）  
> 范围：~63 files / +5123 −650（manager domain 配置化、DNS-01 证书、Settings SSL、soft TLS defaults、Docker greenfield bootstrap）  
> 审查状态：15 findings **CONFIRMED**  
> **修复状态（2026-07-20）：15 / 15 已关闭** — 落地 commit `4eaea2e`  
> **残差修复（R1–R4）**：对抗复审残留 — 见下文 Residual review

---

## 修复总览

| 级别 | 数量 | 已修 | 提交 |
|---|---|---|---|
| Critical | 7 | 7 | `4eaea2e` |
| High | 5 | 5 | `4eaea2e` |
| Medium | 3 | 3 | `4eaea2e` |
| Residual | 4 | 4 | （本轮） |

| ID | 状态 | 修复要点 |
|---|---|---|
| C1 | **FIXED** | `buildBoundManagerConfig({ baseSsl })` + `upsertManagerDraft` 从 draft/active 合并 SSL |
| C2 | **FIXED** | 表单只传 `forceHttps`，不再硬写 `enabled: false` |
| C3 | **FIXED** | TLS seed 使用合法 `ops@${primary}` email |
| C4 | **FIXED** | seed 一律 draft + `serve.ts` enqueue preflight + publish（含 TLS ok；见 R2） |
| C5 | **FIXED** | reserved = active ∪ draft manager hostnames |
| C6 | **FIXED** | order 写 `unpublishedBaseVersionId`；activation 按 SAN 选 baseline |
| C7 | **FIXED** | manager 证书激活后清 `draftVersionId` |
| H1 | **FIXED** | 无 Origin 的 mutating 请求恢复 403 |
| H2 | **FIXED** | admin + manager 同事务；复用 seed manager 行 |
| H3 | **FIXED** | rebind 调用 `assertHostnamesMutable` |
| H4 | **FIXED** | 先查 active ACME order，再写 SSL draft |
| H5 | **FIXED** | diagnostics 读 DB cert / active snapshot |
| M1 | **FIXED** | poll effect 依赖稳定 `refresh` + `orderId` |
| M2 | **FIXED** | 紧急文件 TLS 仅当 `ssl.enabled` |
| M3 | **FIXED** | Cloudflare 内链改 `LocalizedLink` |
| R1 | **FIXED** | setup 合并 baseSsl；同 hostname 且已 active 则 noop |
| R2 | **FIXED** | TLS seed 不再 direct-active；始终 draft + enqueue |
| R3 | **FIXED** | rebind hostname 变更时清 `certificateId` |
| R4 | **FIXED** | diagnostics 文件证按 active primary/aliases 校验 |

验证：`tsc` / `eslint` 通过；相关单测 54/54；SSL merge 手工断言 `enabled`+`certificateId` 在只改 `forceHttps` 时保留。

### Residual review（R1–R4）

| ID | 级别 | 文件 | 修复 |
|---|---|---|---|
| R1 | high | `service.ts` setup | `createManagerDraftFromSetupInTx` 加载 draft/active `baseSsl`；hostname 集不变且已 active 无 draft → `mode=noop`（不 enqueue）；已有匹配 draft → reuse |
| R2 | high | `seed.ts` / `serve.ts` | 去掉 `activateImmediately`；始终 draft + 返回 `draftVersionId`；`serve` 在 seeded 后始终 preflight+publish |
| R3 | high | `service.ts` upsert | hostname 集相对 base 变更时 patch `certificateId: undefined`（除非显式传入） |
| R4 | medium | `settings.ts` diagnostics | 文件证用 `validateManagerTlsFiles` 对 active primary 再 aliases，不再依赖 `MANAGER_HOST` env |

---

## 摘要（审查时）

本分支把 manager 从 env 硬编码迁到 DB 可配置域名 + root-only nginx 部署 + DNS-01 证书。主链路可用，但有几条**会直接弄坏 HTTPS / 升级 seed / rebind / setup** 的缺陷；已在 `4eaea2e` 处理 Critical / High / Medium。

| 级别 | 数量 | 主题 |
|---|---|---|
| Critical | 7 | SSL wipe、seed 失败、hostname 预留、activation/draft 剥 TLS |
| High | 5 | Origin 回归、setup 事务、ACME 并发、diagnostics 误报 |
| Medium | 3 | poll 风暴、紧急 TLS 无视 enabled、LocalizedLink |

---

## Critical

### C1. Settings 保存重建 SSL，丢掉 `certificateId` / `enabled`

- **文件**：`src/worker/lib/manager/service.ts`（原 ~125）
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：`upsertManagerDraft` 每次经 `buildBoundManagerConfig` 从 `defaultManagerSsl()` 重建，不合并当前 snapshot 的 SSL。
- **失败场景**：Manager 已有 active ACME（`ssl.enabled=true` + `certificateId`）。用户改 hostname / aliases / forceHttps 后 Save → draft 无 `certificateId` 且 `enabled=false` → Publish 后 `buildManagerRootInput` 不再挂 ACME 路径 → 公网 manager HTTPS 消失。
- **相关**：`src/shared/schemas/manager.ts`（`buildBoundManagerConfig` 无 previous-snapshot 参数，partial ssl 无法保留 `certificateId`）。
- **修复**：`buildBoundManagerConfig` 增加 `baseSsl`；`upsertManagerDraft` 从 draft/active 加载 SSL 再 merge partial patch，保留 `certificateId` / `enabled`。

### C2. UI 每次 Save 硬编码 `ssl.enabled: false`

- **文件**：`src/components/pages/settings/forms/manager-settings-form.tsx`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：`saveDraft` 固定发送 `ssl: { forceHttps, enabled: false }`，稳定触发 C1。
- **失败场景**：DNS-01 激活后只改 aliases / forceHttps 点 Save → 服务端产出 TLS-off draft → Publish 去掉 `listen 8443` / `ssl_certificate`。
- **修复**：表单仅传 `{ forceHttps }`；由服务端合并当前 snapshot。

### C3. 升级 seed：`enabled:true` + 空 email 被 schema 拒绝，错误被吞

- **文件**：`src/worker/lib/manager/seed.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：`tlsOk=true` 时 `ssl: { enabled: true, email: "" }`；`managerSslConfigSchema` 在 enabled 时要求合法 email。`serve.ts` catch 后仅打日志。
- **失败场景**：存量升级设了 `MANAGER_HOST` + 合法 `MANAGER_TLS_*` → seed 抛错 → 无 `type=manager` 行 → 面板停在 bootstrap-only，旧公网 host 永不 re-bind。
- **修复**：TLS seed 使用 `ops@${primary}` 作为合法过渡邮箱。

### C4. seed 写 active/draft 后从不 enqueue root rebuild/deploy

- **文件**：`src/worker/lib/manager/seed.ts` / `src/worker/serve.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：seed 事务结束后 return；`serve.ts` 只 seed → `verifyRuntime` → `resumeQueuedDeployments`，不创建 publish/rebuild job。docs `manager-domain.md` §11.1 要求 draft 路径立即 root rebuild。
- **失败场景**：非 TLS seed（或修好 C3 后的 TLS seed）DB 声称 bound，nginx 仍是 bootstrap `localhost`/`127.0.0.1`，直到人工 Publish。
- **修复**：draft seed 返回 `draftVersionId` + checksum；`serve.ts` enqueue preflight + publish（失败则保留 draft 可 Settings 重试）。

### C5. rebind draft 期间仍在服务的 active manager host 不再 reserved

- **文件**：`src/worker/lib/domain/validation.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：`collectReservedHostnames` 对 manager 只解析 `draftVersionId ?? activeVersionId`；`saveDraftVersion` 会把 `domains.primaryHostname` / aliases 改成 draft 值。
- **失败场景**：active=`panel.example.com`，draft rebind=`panel2` → reserved 仅 `panel2` → 业务域名可占用 `panel.example.com`，而 root 仍在为 manager 服务该名 → `server_name` 冲突 / 控制面 host 被抢。
- **修复**：union(active snapshot hosts, draft snapshot hosts)。

### C6. 证书激活 baseline 用 active，order SAN 来自 draft

- **文件**：`src/worker/lib/acme/activation.ts` / `src/worker/lib/manager/certificate.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：`loadCurrentManagerConfig` / order identifiers 优先 draft；`unpublishedBaseVersionId` 在已有 `activeVersionId` 时置 `null`；`processCertificateActivation` 用 `activeVersionId ?? unpublishedBaseVersionId`。
- **失败场景**：active v5 + draft v6（新 hostname）→ 未 publish 先 DNS-01 → order SAN= draft → activation base= active → `sameHostnames` 失败 → 激活永久失败。
- **修复**：order 始终写 `unpublishedBaseVersionId=prepared.versionId`；activation 按 SAN 在 `[unpublished, draft?, active]` 中选 baseline（业务域仍不拿无关 draft，避免破坏原行为）。

### C7. cert activation 提交后保留 SSL draft；再 publish 可剥掉 TLS

- **文件**：`src/worker/lib/deployment/runner.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：`!certificateActivation` 才 `draftVersionId: null`。`ensureManagerSslDraft` 的 draft（`enabled=true`、无 `certificateId`）在激活成功后仍挂在 domain 上，`canPublish` 仍为 true。
- **失败场景**：发证成功 → active 已带 `certificateId` → 用户 Publish 残留 draft → active 变回无 `certificateId` → HTTPS 被剥掉。
- **修复**：manager 域在 certificate activation 提交时同样清 `draftVersionId`；业务域仍保留无关 draft。

---

## High

### H1. `requireSameOrigin` 放行缺 Origin 的 mutating 请求（相对 main 回归）

- **文件**：`src/worker/middleware/auth.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：main 在无 Origin 时 `allowed=false` → 403；曾 early-return `next()`。
- **失败场景**：带 session cookie、省略 Origin 的非浏览器客户端可打 mutating 端点。
- **修复**：无 Origin 恢复 403；非浏览器需显式带 allowed Origin。

### H2. Setup 先提交 admin 再 bind manager；manager 失败则 setup 永久卡死

- **文件**：`src/worker/routes/auth.ts` / `src/worker/lib/manager/service.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：admin 插入独立事务；随后总是 INSERT 新 manager，不复用 seed 行；`domains_one_manager` 会冲突。
- **失败场景**：seed 已建 `type=manager` → POST setup 带 hostname → admin 已写 → manager INSERT 失败 → 无法重试 setup。
- **修复**：hostname 预检在写 admin 前；admin+manager **同事务**；`createManagerDraftFromSetupInTx` 复用已有 seed 行。

### H3. Manager rebind 不调用 `assertHostnamesMutable`

- **文件**：`src/worker/lib/manager/service.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：业务 domain 会拦非终态 ACME 下的 hostname 变更；manager 只做 available 检查。
- **失败场景**：DNS-01 进行中 rebind → activation SAN 永久失败。
- **修复**：`upsertManagerDraft` 对已有 manager 调用 `assertHostnamesMutable`。

### H4. `ensureManagerSslDraft` 在 active-order 检查之前执行

- **文件**：`src/worker/lib/manager/certificate.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：新 Idempotency-Key 重试时先写 SSL draft，再抛 `DOMAIN_HAS_ACTIVE_ORDER`。
- **失败场景**：已有非终态 order → 重试污染 draft → 后续 publish 与在途 order 不同步。
- **修复**：先 `requireManagerDomain` + active-order 守卫，再 `ensureManagerSslDraft`。

### H5. Diagnostics 硬依赖 `MANAGER_TLS_*` env，ACME 存活仍报 invalid

- **文件**：`src/worker/routes/settings.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：diagnostics 始终调 env 文件校验；不看 DB certificate / active snapshot。
- **失败场景**：greenfield + DNS-01 正常 → 无 env TLS → UI 报 manager TLS invalid。
- **修复**：优先 active snapshot + ACME cert；`bootstrap` / `bound-http` / `file` 分状态；env 文件仅作回退。

---

## Medium

### M1. SSL 订单 poll effect 依赖不稳定对象，近 tight-loop

- **文件**：`src/components/pages/settings/forms/manager-ssl-form.tsx`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：effect deps 含整份 `useApiQuery` 结果对象，`setOrderDetail` 触发 re-render 重启 effect。
- **修复**：只依赖 `activeOrderId` / `canIssue` / 稳定 `refresh` / `onChanged`；timer 清理。

### M2. 紧急 `MANAGER_TLS_*` 在 bound 时无视 `ssl.enabled=false`

- **文件**：`src/worker/lib/manager/root-input.ts`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：env 文件证书分支不检查 `config.ssl.enabled`。
- **修复**：文件 TLS 仅在 `config.ssl.enabled` 时挂载。

### M3. Cloudflare 内链用裸 `<a href>`，丢掉 locale 前缀

- **文件**：`src/components/pages/settings/forms/manager-ssl-form.tsx`
- **裁决**：CONFIRMED → **FIXED** (`4eaea2e`)
- **摘要**：违反 AGENTS.md §9。
- **修复**：改用 `LocalizedLink`。

---

## 建议修复顺序（已执行）

1. ~~**SSL merge（C1+C2）**~~ → `4eaea2e`
2. ~~**Seed（C3+C4）**~~ → `4eaea2e`
3. ~~**Reserved hosts（C5）**~~ → `4eaea2e`
4. ~~**Activation / draft（C6+C7+H4）**~~ → `4eaea2e`
5. ~~**Origin / setup（H1+H2）**~~ → `4eaea2e`
6. ~~**其余（H3、H5、M1–M3）**~~ → `4eaea2e`

---

## 审查方法（简记）

| 阶段 | 内容 |
|---|---|
| Phase 0 | `git diff main...HEAD`（63 files） |
| Phase 1 | 10 角度并行 finder |
| Phase 2 | 去重后 1-vote 验证；本报告仅保留 CONFIRMED |
| Phase 3 | Gap sweep |
| Phase 4 | 修复落地 `4eaea2e`；单测 + typecheck + SSL merge 断言 |

---

## 未纳入（已验证但降级 / 非本 PR 产品阻塞）

- Manager cert API 与 `routes/certificates.ts` 大段 copy-paste：维护漂移风险真实，属 reuse/altitude，非即时正确性崩溃。
- `setSessionCookie` 改用 `X-Forwarded-Proto`（R4 有意设计）；Docker 拓扑下由 nginx 注入，仅当 worker 直暴露时有残留风险 → PLAUSIBLE。
- 原生 `<select>` vs `components/ui/Select`：约定违规但无运行时代价。
- Manager deploy commit 跳过 `certificates.autoRenew` 同步：真实 skip，首发多由 `resolveAutoRenew` 掩盖；C7 语境已覆盖。
