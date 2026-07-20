# nginx-panel

一个基于 **Next.js 静态导出 + Hono Node API（better-sqlite3）** 的项目。前端构建为纯静态文件，API 以 Node 进程运行（@hono/node-server），开发时通过同域 `/api/*` 访问后端。可作为 Tauri 桌面/iOS 壳应用打包。

## 技术栈

**前端**
- [Next.js](https://nextjs.org) 16（Pages Router，`output: "export"` 静态导出）
- [React](https://react.dev) 19
- [Tailwind CSS](https://tailwindcss.com) 4
- [shadcn/ui](https://ui.shadcn.com) 组件库（基于 Radix UI / Base UI）
- [Recharts](https://recharts.org)、[Embla Carousel](https://www.embla-carousel.com)、[cmdk](https://cmdk.paco.me)、[Sonner](https://sonner.emilkowal.ski)、[Vaul](https://github.com/emilkowalski/vaul) 等扩展组件

**后端**
- [Hono](https://hono.dev) — Web 框架，跑在 Node 运行时
- [`@hono/node-server`](https://github.com/honojs/node-server) — Node HTTP 服务器适配
- [Drizzle ORM](https://orm.drizzle.team) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 本地文件 SQLite

**工具链**
- [pnpm](https://pnpm.io) 包管理
- [TypeScript](https://www.typescriptlang.org) 5
- [ESLint](https://eslint.org) 9 + eslint-config-next
- [concurrently](https://github.com/open-cli-tools/concurrently) — 并发启动前端与后端 dev server
- [Tauri](https://tauri.app) v2 — 桌面/iOS 壳

## 目录结构

```txt
src/
├── components/      # shadcn/ui 组件 + 业务组件
├── hooks/           # React hooks
├── lib/             # 浏览器端工具函数
│   ├── adapter/     # Tauri/浏览器能力适配层（fetch、dialog、request）
│   └── api.ts       # 唯一 API 入口
├── pages/           # Next.js Pages Router 页面（静态导出）
├── shared/          # 前后端共享的类型与工具
├── styles/          # 全局样式 / Tailwind 主题
└── worker/          # Hono API（Node 运行时）
    ├── index.ts     # createApp()，挂载中间件/路由
    ├── serve.ts     # Node 入口（@hono/node-server）
    ├── routes/      # 路由模块（health）
    ├── middleware/  # 中间件（db、auth、error、env）
    ├── db/          # better-sqlite3 引擎
    └── lib/         # Worker 工具（errors、validator）
drizzle/             # Drizzle 生成的 SQL 迁移
drizzle.config.ts    # Drizzle 配置（generate-only）
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
| Node API（Hono） | http://localhost:8787 |

前端通过 `next.config.ts` 的 `rewrites` 将 `/api/*` 代理到 `:8787`，开发时浏览器直接请求同域 `/api/*` 即可，无需关心端口或 CORS。

> `output: "export"` 下 `rewrites` 仅在 `next dev` 生效；生产环境同域 `/api/*` 由你的 Node 服务/反代承载，不依赖 Next 的 rewrites。

示例接口：

```bash
curl http://localhost:8787/api/health   # {"ok":true}
```

其他脚本：

```bash
pnpm build          # 静态导出到 out/
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test:e2e:docker # 构建隔离的生产镜像并验证 TLS、深链、安全边界和数据卷恢复
pnpm db:generate    # 生成 Drizzle 迁移（drizzle-kit generate）
```

## 适配层（Adapters）

`src/lib/adapter/` 统一封装 Tauri 原生能力与浏览器降级实现，上层代码无需关心运行环境。所有 API 请求统一走 `src/lib/api.ts`（内部使用 `adapter/fetch`），不要直接使用原生 `fetch` 或 Tauri 插件。

| 模块 | Tauri | 浏览器降级 | 说明 |
|------|-------|-----------|------|
| `adapter/fetch` | `@tauri-apps/plugin-http` 的 `fetch` | `globalThis.fetch` | 绕过 Tauri 的 URL allow-list；`api.ts` 在 Tauri 中自动拼接绝对 URL，浏览器中走相对路径 |
| `adapter/dialog` | `@tauri-apps/plugin-dialog`（`confirm`/`message`） | `window.confirm`/`window.alert` | 统一的确认框/消息框 |
| `adapter/request` | Rust `proxy` 命令（`tauri_plugin_http::reqwest`） | 抛错（仅 Tauri 可用） | 透明 HTTP 请求，返回标准 `Response`；用于绕过 `adapter/fetch` 的限制、读取任意状态码/响应体 |

> `adapter/request` 仅在 Tauri 环境可用，依赖 Rust 侧的 `proxy` 命令（见 `src-tauri/src/lib.rs`）。

## 数据库（Database）

后端使用 better-sqlite3 本地文件库，Drizzle ORM 访问，schema 共享于 `src/shared/schemas/`。

- **read-your-writes**：单写者文件库，同进程内写后立即可读。
- **受影响行数**：better-sqlite3 的 `result.changes`，统一用 `src/worker/lib/db/engine.ts` 的 `affectedRows()` 读取。
- **打包隔离**：`better-sqlite3`、`node:fs`、`node:path` 均动态 import。

数据文件落在 `./.sqlite/app.db`（已加入 `.gitignore`）；由 `DB_SQLITE_DIR` 指定目录，`PORT` 可覆盖默认 8787 端口。

**迁移（Migrations）**

Drizzle schema 改动后先生成迁移文件，Node 服务启动时自动应用：

```bash
pnpm db:generate   # drizzle-kit generate，生成 SQL 到 ./drizzle
```

Node 服务（`serve.ts`）启动时由 better-sqlite3 migrator 自动从 `./drizzle` 应用迁移，无需手动执行。

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
