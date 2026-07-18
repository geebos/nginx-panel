# cf-next-pages-routes

一个基于 **Next.js 静态导出 + Hono Cloudflare Worker** 的模板仓库。前端构建为纯静态文件部署到 Cloudflare Pages，API 以独立 Worker 运行，开发与生产均通过同域 `/api/*` 访问后端。

## 技术栈

**前端**
- [Next.js](https://nextjs.org) 16（Pages Router，`output: "export"` 静态导出）
- [React](https://react.dev) 19
- [Tailwind CSS](https://tailwindcss.com) 4
- [shadcn/ui](https://ui.shadcn.com) 组件库（基于 Radix UI / Base UI）
- [Recharts](https://recharts.org)、[Embla Carousel](https://www.embla-carousel.com)、[cmdk](https://cmdk.paco.me)、[Sonner](https://sonner.emilkowal.ski)、[Vaul](https://github.com/emilkowalski/vaul) 等扩展组件

**后端**
- [Hono](https://hono.dev) — Cloudflare Worker 上的 Web 框架
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — Worker 本地开发与部署
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite 数据库（已配置占位，按需启用）
- [`@cloudflare/workers-types`](https://www.npmjs.com/package/@cloudflare/workers-types) — Worker 类型定义

**工具链**
- [pnpm](https://pnpm.io) 包管理
- [TypeScript](https://www.typescriptlang.org) 5
- [ESLint](https://eslint.org) 9 + eslint-config-next
- [concurrently](https://github.com/open-cli-tools/concurrently) — 并发启动前端与后端 dev server

## 目录结构

```
src/
├── components/      # shadcn/ui 组件 + 业务组件
├── hooks/           # React hooks
├── lib/             # 浏览器端工具函数
│   ├── adapter/     # Tauri/浏览器能力适配层（fetch、dialog、request）
│   └── api.ts       # 唯一 API 入口
├── pages/           # Next.js Pages Router 页面（静态导出）
├── shared/          # 前后端共享的类型与工具
├── styles/          # 全局样式 / Tailwind 主题
└── worker/          # Cloudflare Worker + Hono API
    ├── routes/      # 路由模块（health、hello）
    └── index.ts     # Worker 入口
wrangler.jsonc       # Worker 配置（D1 占位、无 routes）
next.config.ts       # 静态导出 + dev rewrites 代理
components.json      # shadcn 配置
```

## 快速开始

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会并发启动：

| 服务 | 地址 |
|------|------|
| Next.js（前端） | http://localhost:3000 |
| Wrangler（Worker API） | http://localhost:8787 |

前端通过 `next.config.ts` 的 `rewrites` 将 `/api/*` 代理到 `:8787`，开发时浏览器直接请求同域 `/api/*` 即可，无需关心端口或 CORS。

示例接口：

```bash
curl http://localhost:3000/api/health   # {"ok":true}
curl http://localhost:3000/api/hello    # {"name":"John Doe"}
```

其他脚本：

```bash
pnpm build          # 静态导出到 out/
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm deploy:web     # 构建前端静态文件
pnpm deploy:worker  # wrangler deploy
```

## 架构

**开发环境**：`next dev` 与 `wrangler dev` 同时运行，Next.js 通过 `rewrites` 把 `/api/*` 转发到 Worker（`:8787`）。前后端同域（`localhost:3000`），前端代码统一使用相对路径 `/api/*`。

**生产环境**：Next.js 静态导出到 `out/`，部署到 Cloudflare Pages；Hono Worker 独立部署，并通过同域 route 绑定 `/api/*`，使生产环境同样以相对路径访问 API。

> 注意：`output: "export"` 模式下 `rewrites` 仅在 `next dev` 生效，生产环境依赖 Cloudflare 的同域 route，而非 Next 的 rewrites。

## 适配层（Adapters）

`src/lib/adapter/` 统一封装 Tauri 原生能力与浏览器降级实现，上层代码无需关心运行环境。所有 API 请求统一走 `src/lib/api.ts`（内部使用 `adapter/fetch`），不要直接使用原生 `fetch` 或 Tauri 插件。

| 模块 | Tauri | 浏览器降级 | 说明 |
|------|-------|-----------|------|
| `adapter/fetch` | `@tauri-apps/plugin-http` 的 `fetch` | `globalThis.fetch` | 绕过 Tauri 的 URL allow-list；`api.ts` 在 Tauri 中自动拼接绝对 URL，浏览器中走相对路径 |
| `adapter/dialog` | `@tauri-apps/plugin-dialog`（`confirm`/`message`） | `window.confirm`/`window.alert` | 统一的确认框/消息框 |
| `adapter/request` | Rust `proxy` 命令（`tauri_plugin_http::reqwest`） | 抛错（仅 Tauri 可用） | 透明 HTTP 请求，返回标准 `Response`；用于绕过 `adapter/fetch` 的限制、读取任意状态码/响应体 |

> `adapter/request` 仅在 Tauri 环境可用，依赖 Rust 侧的 `proxy` 命令（见 `src-tauri/src/lib.rs`），已启用 gzip/brotli/deflate/zstd 自动解压。

## 数据库（Database）

Worker 通过环境变量在两套 SQLite 引擎间切换，路由代码不变，共享同一套 Drizzle schema（`src/shared/schemas/`）。

| 引擎 | 运行时 | 实现 | 切换条件 | 适用场景 |
|------|--------|------|---------|---------|
| `d1`（默认） | Cloudflare Workers（Wrangler） | `drizzle-orm/d1` + wrangler 的 D1 binding | `DB_ENGINE` 非 `sqlite` 时生效 | 线上生产；Serverless、自动弹性、托管备份 |
| `sqlite` | Node（`@hono/node-server` + `tsx`） | `better-sqlite3` 本地文件库 | `DB_ENGINE=sqlite` + `DB_SQLITE_DIR=<dir>` | 本地开发 / Tauri 桌面后端 / 自托管，无需 Cloudflare 账号 |

**关键差异**

- **会话级 read-your-writes**：D1 由 `db.ts` 中间件用 bookmark cookie 实现（同请求窗口内写后立即可读）；本地 SQLite 是单写者文件库，天然 read-your-writes，不需要 bookmark。
- **受影响行数**：D1 在 `result.meta.changes`，better-sqlite3 在 `result.changes`，统一用 `src/worker/db/engine.ts` 的 `affectedRows()` 读取。
- **打包隔离**：`better-sqlite3`、`node:fs`、`node:path` 均动态 import，确保 `d1` 路径的 CF Workers 打包不会引入原生模块或 Node 文件系统 API。

**切换方式**

- 生产 / 默认（D1）：直接 `pnpm dev` 或 `pnpm deploy:worker`，无需设置环境变量。
- 本地 SQLite：
  ```bash
  pnpm dev:sqlite   # 内部: DB_ENGINE=sqlite DB_SQLITE_DIR=./.sqlite pnpm dev:worker:sqlite
  ```
  数据文件落在 `./.sqlite/app.db`（已加入 `.gitignore`）；`DB_SQLITE_DIR` 可指向任意目录，`PORT` 可覆盖默认 8787 端口。

**迁移（Migrations）**

Drizzle schema 改动后先 `drizzle-kit generate` 生成 SQL 到 `./drizzle`，再按引擎应用：

```bash
pnpm db:generate            # 生成迁移文件（drizzle-kit generate）
# D1：本地 / 远端分别应用
pnpm migrate:local          # wrangler d1 migrations apply todos --local
pnpm migrate:remote         # wrangler d1 migrations apply todos --remote
```

> D1 用 `wrangler d1 migrations apply`（记录在 `d1_migrations` 表），不要用 `drizzle-kit migrate`。本地 SQLite 引擎在进程启动时自动从 `./drizzle` 应用迁移，无需手动执行。

## 部署到 Cloudflare

1. **前端（Pages）**
   - 构建命令：`pnpm build`
   - 输出目录：`out`

2. **后端（Worker）**
   ```bash
   pnpm deploy:worker
   ```

3. **同域 route 绑定**：在 `wrangler.jsonc` 中为 Worker 绑定 `/api/*` 路由（替换为你的域名）：
   ```jsonc
   "routes": [
     { "pattern": "your-domain.com/api/*", "zone_name": "your-domain.com" }
   ]
   ```
   只绑定 `/api/*`，避免 Worker 接管整站覆盖 Pages 静态页面。

4. **D1（可选）**：默认引擎为 D1。`wrangler.jsonc` 中已保留 D1 占位配置，启用时替换 `database_id`、运行 `pnpm migrate:remote` 应用迁移；切换本地 SQLite 引擎与迁移细节见上方[数据库](#数据库database)章节。

5. **敏感配置**：使用 `wrangler secret put <NAME>` 设置，不要放入前端环境变量。

## Tauri iOS

仓库已包含 `src-tauri/`（Tauri v2），可将同一套静态导出的 Next.js 前端打包成 iOS App。首次使用按以下步骤配置：

1. **安装 Rust**：参考 [rustup 官网](https://rustup.rs) 安装 Rust 工具链。

2. **安装 iOS Rust targets**：
   ```bash
   rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
   ```

3. **初始化 iOS 工程**：
   ```bash
   pnpm tauri ios init
   ```
   生成 `src-tauri/gen/apple/` 下的 Xcode 工程。

4. **配置签名**：用 Xcode 打开 `src-tauri/gen/apple/native.xcodeproj`，在 Signing & Capabilities 中选择开发 Team（`tauri.conf.json` 里已预填 `developmentTeam: 9CXCT8UD3F`，按需替换为你自己的 Team ID）。

5. **开发运行**：
   ```bash
   pnpm tauri ios dev
   ```

6. **编译 IPA**：
   ```bash
   pnpm tauri ios build
   ```
