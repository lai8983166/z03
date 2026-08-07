# Design: setup-ts-baseline

## Context

现状：纯 JS 项目（后端 CommonJS `server.js` 53KB、前端原生 ES module、`Command.js` 144KB），无类型、无测试；`server.js` 硬编码全部运行时参数；`config.json` 已过时（写 `192.168.10.x`，实际联调用 `192.168.0.x`），且 `server.js` 根本没读它。

已确认的技术选型（用户拍板）：TypeScript + **Vite** + **Vitest**，首个 change 只搭工程基线。

6 条硬约束（详见 `proposal.md` 与 `openspec/config.yaml`）：行为不变 / 不随便引入依赖 / 每 change 一次 git 提交 / 测试一律 mock / 不改 HTML/CSS/JS 样式 / 遗留代码保留并维持调用关系。本 design 的所有决策都在这 6 条约束内做权衡。

## Goals / Non-Goals

**Goals**
- 提供 TS 编译与类型检查能力（`tsc --noEmit`），现有 `.js` 与新增 `.ts` 共存。
- Vite 托管前端，dev/build 行为与重构前一致。
- Vitest 测试骨架可用，全程 mock，零真实网络/串口/子进程。
- 运行时参数集中到 `config.json`，`server.js` 仅读取不硬编码，值校准到真实联调状态。
- 统一 npm scripts（dev / dev:server / build / test / typecheck）。

**Non-Goals**
- 不迁移任何业务 JS 到 TS（留给后续 change）。
- 不引入 Linter/Formatter、`ni`、`tsx`、`nodemon`、`jsdom`。
- 不修改 `index.html`、`style.css`、任何 JS 中的样式代码。
- 不改动遗留代码（ffmpeg/RTSP 等）的调用关系。

## Decisions

### D1. 前端 WS 直连后端，不配 Vite WS 代理
- 现状：`js/Client.js:11-12` 用 `ws://${window.location.hostname}:8081`，`js/ImageUploadClient.js:28-29` 用 `:8082`；`server.js` 的 `wss`/`wssImg` 未设 `verifyClient`/origin 校验。
- 决策：Vite dev server（默认 5173）下，`window.location.hostname` 解析为 `localhost`，前端自动连 `ws://localhost:8081/8082`，**直连后端即可**。不配 WS 代理，**两个 WS 客户端文件零改动**。
- 否决方案：配 Vite WS 代理 + 改 Client URL → 需改前端逻辑，违反最小改动原则。
- 残余风险：若后端 `wss` 未来加了 origin 校验会失败 → 本 change 不改 `wss` 配置，维持现状。

### D2. Vite 仅配 HTTP 代理转发静态资源
- 现状：`main.js` 中 `Utils.loadCSVToTable` 用 `fetch('csv/...')` 相对路径；`server.js:8080` 服务这些静态资源。
- 决策：`vite.config.ts` 用 `server.proxy` 把 `/csv`（及实施时确认的其他静态路径）代理到 `http://localhost:8080`，让 fetch 行为与原来一致。
- 否决方案：把 `csv/` 移入 Vite `publicDir` → 会改目录结构，且 `csv/` 是协议配置数据，不应挪动。

### D3. 抽 `config.js` 模块承载配置读取与校验
- 决策：新建 `config.js`（**.js 而非 .ts**——server.js 是 CommonJS 且 `node server.js` 直跑无法 `require` `.ts`，见 D5；用 JSDoc 提供 `Config` 类型供 tsc/IDE 识别），导出 `loadConfig(path)` + `validateConfig(c)` 纯函数（读 JSON + 校验关键字段，缺失即抛错）。`server.js` 顶部改为 `const cfg = loadConfig('./config.json')`，用 `cfg.*` 替换硬编码常量。
- 边界：**只抽 config 读取**，`server.js` 其余逻辑（含 ffmpeg 等遗留代码）逐字不动，遗留代码内的常量也只换读取方式。
- 理由：spec 要求 config 缺失/字段缺失明确报错（健壮性 requirement）；独立模块便于 smoke 测试（测 `loadConfig` 错误路径，全 mock）。
- skill 权衡：`eric-backend` 要求 "validate at trust boundaries"——config 是 server 启动的 trust boundary，校验放这里。

### D4. TypeScript 配置：allowJs、不开 strict、双 tsconfig
- `tsconfig.json`：`allowJs:true`、`checkJs:false`、`strict:false`、`noEmit:true`；覆盖前端与共用。
- `tsconfig.node.json`：`extends` 根 tsconfig，给 server 端（含 `@types/node`）。
- 否决方案：开 `strict` → 海量 `.js` 雪崩式报错，否决；单 tsconfig → 前后端运行环境差异需两份，否决。
- skill 权衡：`eric-quality-control` 的 tool defaults 用 `tsc --noEmit` 作为 typecheck 门，符合。

### D5. 后端运行方式不变
- `server.js` 仍是 `.js`，`node server.js` 跑，不引入 `tsx`/`ts-node`。本 change 不迁移后端代码，运行时依赖零变更。
- skill 权衡：`eric-javascript` 要求引入 Antfu `ni` → 受"不随便引入依赖"约束，**不引入 `ni`**，直接用 `pnpm`/`pnpm run`。

### D6. Vitest：node 环境、不引入 jsdom、smoke 测 `loadConfig`
- `vitest.config.ts`：`environment: 'node'`，`include: ['tests/**/*.test.ts']`。
- smoke 测试：测 `loadConfig` 的错误路径（文件缺失、关键字段缺失 → 抛预期错误）；用临时目录或 mock `fs`，**绝不碰真实网络/串口/子进程**。
- 否决方案：trivial `expect(1+1).toBe(2)` → 价值低；引入 jsdom 测 DOM → 本 change 不需要。
- skill 权衡：`eric-writing-tests` 的 Global Gate——smoke 测 `loadConfig` 既证明测试链路通，又有真实回归价值（config 健壮性），符合"lightest method that proves the result"。

### D7. config.json 结构与校准
- 分组：`http` / `ws` / `bridges[3]` / `turntable` / `video` / `imageUpload` / `dataDir`（实施时按 1.1 清单最终确定）。
- 校准值以 `server.js` grep 为唯一真相：本地 IP `192.168.0.20`、远端 `192.168.0.170`、端口 `30041/30042/30040`、图像上传远端 `192.168.10.1:61440`、`COM7`、`115200`、RTSP `rtsp://192.168.10.1:8554/live`、`128×128`。
- `config.example.json` 同结构、真实值（联调环境内部模板）。
- 遗留功能配置项（如 ffmpeg 路径）保留——随代码保留，不算"接入"（见遗留代码处理原则）。

## Risks / Trade-offs

- **config 校准抄错 → 联调环境断连** → 以 `server.js` grep 值为唯一真相，逐项 diff；tasks 6.3 用 grep 复核 `server.js` 已无业务硬编码。
- **Vite HTTP 代理路径遗漏 → CSV/其他资源 404** → tasks 3.1 先穷举前端 fetch 路径与 server.js 静态服务范围，再定代理清单。
- **`strict:false` 削弱类型保护** → 本 change 不写业务 TS；后续各 change 在自己范围里逐步打开 strict。
- **抽 `config.js` 算改 `server.js`** → spec 已授权"server.js 仅改常量读取方式"；保持抽取最小化（只抽 config，不抽其他）。
- **前端 WS 跨端口 origin** → 后端 `wss` 现状不校验 origin；本 change 不改 `wss` 配置。

## Migration Plan

- 本 change 为开发基础设施，无生产部署迁移。
- 实施顺序：配置统一 → TS 工程 → Vite → Vitest → 验收 → git 提交。
- 回滚：`git revert` 即可。唯一与运行行为相关的改动是 `server.js` 改读 `config.json`，而值已逐字校准，revert 后立即恢复原状。

## Open Questions

- `server.js` HTTP 静态服务的确切范围（决定 Vite HTTP 代理清单）→ tasks 3.1 实施时确认。
- Excel 写盘路径、帧字节大小等常量是否纳入 config → 实施时按"是否运行时可变"判断，纳入则进 config。
