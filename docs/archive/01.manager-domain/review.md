# Manager Domain 配置化设计评审

> 评审对象：[manager-domain.md](./manager-domain.md)（**v1.2**）  
> 最新：Review **v4**（2026-07-20）— 终局复核  
> 状态：**R1–R28 全部关闭；无新编号；设计评审循环结束**

---

## 轮次状态

| 轮次 | 日期 | 结果 |
|---|---|---|
| Review v1 | 2026-07-20 | R1–R20 |
| Author v1 | 2026-07-20 | 正文 v1.1 → R1–R20 ✅ |
| Review v2 | 2026-07-20 | R21–R27 |
| Author v2 | 2026-07-20 | 回复表先到，正文未齐 |
| Review v3 | 2026-07-20 | 拒关 R21–R27；开 R28（关闭纪律） |
| Author v3 | 2026-07-20 | 正文落地 R21–R27；§10.4 skip；回复表可检索短语 |
| Review v4 | 2026-07-20 | **`rg` 复核通过；无新问题；循环结束** |

**门禁：设计层通过。可按 §13 分期实现 P0→P4。**

---

## Review v4 关闭复核（`rg`）

| 编号 | 可检索短语 | 状态 |
|---|---|---|
| R1–R20 | v1.1 正文（此前已核） | ✅ |
| R21 | `Create bind` / `unconfigured → Create bind` / `无 manager 行 → Create bind` | ✅ |
| R22 | `reserved =` / `含 draft-only` | ✅ |
| R23 | `"bound": true` / `"bound": false` / `bound=false` / `local.manager.invalid` | ✅ |
| R24 | `tlsOk` / `rootServesHost` / `直接 active` | ✅ |
| R25 | `对外唯一证书 API` / `/api/settings/manager/certificate/*` | ✅ |
| R26 | `跨 Host` / `host-only` | ✅ |
| R27 | `完全跳过 root 重写` / 不调用 `refreshActiveRoot` | ✅ |
| R28 | 关闭须正文可检索；Author v3 已遵守 | ✅ |

自检：

```sh
rg -n 'Create bind|status: unconfigured' docs/manager-domain.md
rg -n 'reserved =|draft-only' docs/manager-domain.md
rg -n '"bound": true|"bound": false|local\.manager\.invalid' docs/manager-domain.md
rg -n 'tlsOk|rootServesHost|直接 active' docs/manager-domain.md
rg -n 'settings/manager/certificate|对外唯一证书' docs/manager-domain.md
rg -n '跨 Host|host-only' docs/manager-domain.md
rg -n '完全跳过|refreshActiveRoot' docs/manager-domain.md
```

---

## 实现前门禁（编码 checklist）

1. [ ] `start.mjs`：无 active → bootstrap；**有 active → 完全 skip root 重写**
2. [ ] Cookie `Secure` 跟 `$scheme` / `X-Forwarded-Proto`（模板勿写死 https）
3. [ ] `requireSameOrigin` = bootstrap ∪ bound allowlist
4. [ ] `RenderManagerRootInput` + 分 server 模板
5. [ ] verifier / manifest 仅 `type=domain`
6. [ ] Setup 可选 manager：draft → deploy → active（snapshot 含 `bound=true`）
7. [ ] Settings：`unconfigured` → Create bind
8. [ ] reserved 冲突含 draft manager + 占位保留名
9. [ ] P0 e2e：无 env 启动 + HTTP setup/login

---

## 实现期顺手对齐（不另开设计编号）

下列不影响架构；**Author 已在 v1.2 微补写入正文**（可 `rg`）：

- [x] §6.2 Setup 插入句显式 `bound=true`
- [x] §7.4 Rebind 校验对齐 §8.1 `reserved`

---

## 下一轮规则

- **设计评审循环已结束。**  
- 实现 PR 若偏离 v1.2，新意见从 **R29** 起编，只审 diff。  
- 勿再为空回复表重开循环。

---

## 附录：编号索引

| 段 | 主题 |
|---|---|
| R1–R6 | 启动/root/分 server/Cookie/Origin/渲染输入 |
| R7–R14 | Rebind-only/Setup 时序/tombstone/分流/迁移/$scheme/tls reload/API |
| R15–R20 | schema/过滤/Reset/bootstrap/e2e/覆盖声明 |
| R21–R27 | Create bind/reserved draft/`bound`/升级种子/证书 API/跨 Host/start skip |
| R28 | 关闭纪律（正文可检索） |
