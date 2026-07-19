# PRD 与技术设计评审意见

> 评审对象：[PRD.md](./PRD.md) v1.9、[TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) v1.9
> 评审日期：2026-07-18（基于 v1.9 修订版复核）
> 严重度图例：🔴 阻塞/关键　🟠 重要　🟡 次要

## 0. 总体评价

v1.9 按 S1 方案 1 完成措辞对齐：PRD §8.11/§8.12/§13.5 明确迁移 Warning 只保证覆盖含旧 `logsRoot` 的 revision 保留期，retention 清理后允许提示消失，部署方须在变更环境变量前记录并迁移旧目录；技术设计 §15.3 E2E 同步覆盖 Warning 显示与消失两个边界。验收承诺与 retention 实现已一致，未新增数据库状态。**本次复核未发现任何新增问题——v1.9 是首个零开放问题的版本。** 文档层评审可告一段落，后续进入 §18 spike 5 物理验证与 Phase 1 编码。

## 1. v1.0 → v1.1 已闭环清单

v1.0 评审 20 项问题在 v1.1 全部落实（管理端拓扑/保留主机名、管理端外部证书、Secure Cookie、log-directives、证书激活 Active Version 基线、日志流 semaphore、全量快照替换、Order 期间 hostname 锁、Settings API、ACME account、remove_domain Stepper、路由语义等）。详见前次评审记录，保留作变更追溯。

## 2. v1.1 → v1.2 已闭环清单（N1–N10）

| 编号 | v1.2 落点 |
| --- | --- |
| N1 相对 include | §8.2 待验证假设 + §18 ADR + fallback |
| N2 degraded 恢复 | §7.4 `rebuild-active` + `rebuild_active` Deployment |
| N3 auth HMAC key | §5.3 HKDF-SHA-256 从 master secret 派生 |
| N4 管理端证书 reload | §7.4 `reload-manager-tls` |
| N5 `/internal/health` | §7.2 + §8.3/§12.3 三重边界 |
| N6 深链 rewrite | §8.3 已知静态页优先 + regex rewrite |
| N7 revision 清理 | §9.2 step 12 + §9.5 24h 兜底 |
| N8 续期 account_email | §10.8 复用来源 Order email/environment |
| N9 Disabled Domain | §7.3 disable/enable + `toggle_domain` + 503 |
| N10 密码修改限流 | §11.2 password_change purpose 3/30min |

## 3. v1.2 → v1.3 已闭环清单（M1–M8）

| 编号 | v1.3 落点 |
| --- | --- |
| M1 toggle 503 vs 不可变 version | 选定单一模型：§6 删除聚合 `enabled`；§8.1 拆分 Canonical/Runtime Compiler；§8.2 per-revision 完整 runtime server + manifest 三类 checksum |
| M2 toggle 边界 | §7.3 `DOMAIN_NO_ACTIVE_VERSION`/`changed:false`/同目标复用/反向冲突；§9.2 `input_json` 锁 targetEnabled |
| M3 rebuild_active 前置 | §9.5 SQLite integrity + snapshot/checksum/Schema + cert/key + 卷；`ACTIVE_REBUILD_SOURCE_UNAVAILABLE` vs `ACTIVE_REBUILD_FAILED` |
| M4 Disabled + Force HTTPS | §8.3/§10.1 抑制 308，port 80/443 直接 503 |
| M5 续期 account_email 语义 | §10.8 account key 文件缺失/不可读时停止 |
| M6 `/settings` 裸路径 | §8.3 `return 302 /settings/general` + E2E |
| M7 限流桶隔离 | §11.2 `rebuild_active` 独立 purpose 5/15min |
| M8 `DOMAIN_DISABLED` 使用 | §14.3 只用于业务 deploy/rollback |

## 4. v1.3 → v1.4 已闭环清单（P1–P5）

| 编号 | v1.4 落点 |
| --- | --- |
| P1 Disabled Domain 证书 Active UX + 续期 | §8.8/§8.16 "Active · Domain Disabled"；§8.3 停用 Dialog 提示 CA 配额；§7.4 `presentationStatus`；§10.8/§14.2 Disabled+AutoRenew 指标 |
| P2 runtimeStateChecksum 输入集 | §8.2 `RuntimeStateV1`（RFC 8785/JCS + SHA-256）精确枚举；§5.3 `cert_file_checksum`/`public_key_spki_checksum` |
| P3 Canonical vs Runtime 预览 | §8.14 版本详情/Diff 固定 Canonical Preview；§7.4 `runtime-config` API |
| P4 revision 磁盘占用 | §9.5 `NGINX_REVISION_MAX_BYTES` + 数量 20 + 失败 7 天 + 受保护不删 + 空间预检；`REVISION_STORAGE_LIMIT_EXCEEDED` |
| P5 Route enabled=false 语义 | §8.4/§8.7 预览/runtime 均省略 location |

## 5. v1.4 → v1.7 已闭环清单（Q1–Q4）

v1.5 采用 Q1 方案 1（compilerBuildId 移出 drift），v1.6 进一步删除 compilerBuildId/RuntimeStateV1/DeploymentPolicyV1 改用直接配置模型，v1.7 移除 `domain_log_directories` 改用 `NGINX_LOG_DIR`。

| 编号 | v1.7 落点 |
| --- | --- |
| Q1 compilerBuildId 触发镜像升级 degraded | 不再存在。v1.6 删除 compilerBuildId；§8.2 `RuntimeManifestV1` 无生成器 build ID；§9.5 step 3 "Nginx 镜像升级只需用现有 active 配置通过 `nginx -t`，不引入生成器版本或 stale 状态" |
| Q2 `NGINX_REVISION_MAX_BYTES` 重启才能改 | §5.3 `runtime_storage.revisionMaxBytes` 入 settings；§7.4 `PATCH /api/settings/nginx` 即时生效 + 触发 cleanup；§9.5 "修改容量上限不创建 Deployment、不 reload Nginx，并且在 degraded/容量锁状态下仍允许"；`REVISION_STORAGE_LIMIT_TOO_LOW` |
| Q3 compilerBuildId 定义模糊 | 不再存在。v1.6 删除 compilerBuildId |
| Q4 manifest root "部署策略 checksum" 输入集 | v1.6 改用 `RuntimeManifestV1.rootInputs` 显式枚举（appEnv/managerUrl/listeners/managerTls/uiRoot/apiUpstream/staticAllowedRoots/certsRoot/logsRoot）；§9.5 逐字段比对 |

## 6. v1.7 → v1.8 已闭环清单（R1–R4）

| 编号 | v1.8 落点 |
| --- | --- |
| R1 启动未校验磁盘 `domains/*.conf` 集合 | §9.5 step 3 不跟随 symlink 枚举 active `domains/`，磁盘 `*.conf` 文件集合与 `manifest.domains` 推导集合精确相等比较；多出/缺失/symlink/子目录/非普通文件均 degraded；§15.2 故障注入测试 |
| R2 NGINX_LOG_DIR 变更后历史日志无提示 | §8.11/§8.12 Logs 页迁移 Warning；§12.2 Diagnostics 显示旧/新根目录 + 可访问状态 + 手动迁移说明；§7.4 Diagnostics API 返回历史 logsRoot（唯一脱敏例外）；§13.5/§15.3 验收与 E2E |
| R3 renderDomainPreview vs renderDomainConfig 同步 | §8.1 `renderDomainPreview` 改为 `renderDomainConfig(mode="preview")` 薄封装，共用 Route/Header/SSL/Advanced 生成路径，仅 enabled overlay/log 指令/cert 路径差异；§15.1 一致性测试 |
| R4 renderDomainPreview SSL 指令表示 | §8.1/§8.14 Preview 保留 `ssl_certificate <certificate:{certificateId}:fullchain>` + `ssl_certificate_key <certificate:{certificateId}:private-key>` 稳定占位符；不参与 `nginx -t`；§13.1/§15.1 golden Diff |

## 7. v1.8 → v1.9 已闭环清单（S1）

| 编号 | v1.9 落点 |
| --- | --- |
| S1 迁移 Warning 保留期与"持续提示"验收张力 | 采用方案 1（措辞对齐，零额外状态）。PRD §8.11/§8.12 明确 Warning 仅在含旧 `logsRoot` 的 revision 保留期间显示，retention 清理后不再保证；PRD §13.5 验收改为两态："保留期间提示 + retention 清理后不再承诺提示，部署方须在变更环境变量前记录并迁移"；技术设计 §15.3 E2E 补充"清理最后一个含旧 root 的 revision 后，允许 Warning 消失并验证文档化的前置迁移要求" |

S1 文档层闭环。验收承诺与 retention 实现一致，未新增数据库状态或日志目录映射，继续保持 `NGINX_LOG_DIR` 单一环境配置方案。

## 8. v1.9 新增问题

无。v1.9 是 S1 的纯措辞修订，PRD/技术设计其余内容与 v1.8 一致，本次复核未发现新增阻塞、重要或次要问题。

## 9. 最终结论

v1.9 可进入 Phase 1，**无阻塞项、无重要问题、无次要问题**。文档层评审经 v1.0→v1.9 共 9 轮迭代，累计 20+10+8+5+4+4+1=52 项问题全部闭环，设计已构成完整可实施方案：

- **领域模型**：Domain / Config Version / Deployment / Certificate / ACME Order / Certificate Activation 六大对象边界清晰，Order 闭环与发布解耦。
- **配置生成**：`renderRootConfig` + `renderDomainConfig(mode)` + `renderDomainPreview` 三函数直接模型，`include domains/*.conf` 汇总，`RuntimeManifestV1` 逐字段来源 + 文件 checksum。
- **发布引擎**：candidate → `nginx -t` → 原子激活 → reload → 健康检查 → SQLite 事务，失败恢复旧 symlink，`rebuild_active` 处理 degraded。
- **日志子系统**：`NGINX_LOG_DIR` 单一环境配置，分行反向扫描 + 签名 cursor + inode+offset 跨轮动 + NDJSON 控制行 + semaphore 20/5。
- **HTTPS**：HTTP-01/DNS-01 Manual/DNS-01 Cloudflare 三验证方式，ACME account 按 (env,email)，续期复用来源 Order email，Activation Coordinator 严格 Version→Deployment。
- **安全**：管理端外部证书 + 保留主机名 + Secure Cookie + HKDF auth 限流 + `/internal/health` 三重边界 + AES-GCM Cloudflare token + 白名单 Advanced。

唯一前置：**§18 spike 5 ADR** 物理验证"根配置 `include domains/*.conf` + 每域名完整文件 + `RuntimeManifestV1`"模型、`NGINX_LOG_DIR` 校验、candidate/active symlink 原子切换与故障恢复。已无待选实现分支，spike 5 仅用于固化目标 Nginx 版本/复现证据，不再做架构选型。

文档层评审结束，进入实施阶段。

## 10. v1.10 实现对齐复核

2026-07-20 完成 Phase 2 阶段性调整的实现与主文档回写：

- Draft 改为“未发布前原位更新，发布后冻结”；每个 Domain 最多一个 Draft，以最终 checksum、Test/Deploy Deployment 和不可变已发布版本提供审计边界。
- Overview、Routes、SSL、Headers、Advanced 共用 Diff → Test → Publish 三步向导，Test 和 Deploy 均绑定 Version/checksum，发布 Runner 仍执行完整 candidate `nginx -t`。
- 日志历史筛选与实时筛选分别生效，日志类型使用多选 `types`，显示列偏好仅保存在浏览器且不改变采集格式。

复核验证：`pnpm test` 92/92、`pnpm typecheck`、`pnpm lint`、`pnpm build` 和生产 Docker smoke E2E 均通过。PRD 与技术设计版本更新为 v1.10，阶段性调整文档转为已实现的决策历史。
