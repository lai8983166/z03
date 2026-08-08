# Proposal: 后端 TS 运行基线（server/TcpBridge/Udp/config 转 .ts + tsx）

## 背景：范围调整说明

原蓝图 change 3 是"`server.js` 拆分 + TS 化"。调研后发现 server.js **1792 行业务逻辑**（WS message handler、Excel 写盘、RTSP/ffmpeg 视频流、`handleJsonControlMessage`/`handleControlCommand` 控制路由）**完全没有测试**——change 2 只覆盖了协议层纯逻辑（TcpBridge/Udp/CommandBuilder/BinaryTableHelper）。

一次性"重写 1792 行 + 拆 10 模块 + 引入 tsx + 改 require 为 import"没有回归保护网，"行为不变"几乎无法验证。因此本 change **收窄范围**：

- **本 change（3a）**：建立后端 TS 运行能力——`server.js`/`TcpBridge.js`/`js/Udp.js`/`config.js` 转 `.ts` + 引入 tsx + tsconfig 拆分。**不拆模块、不改变量结构、不改 require 为 import**。行为不变靠"tsx 转译等价 + 人工对照"。
- **后续 sub-change（3b/3c…）**：逐个职责提取模块（video / data / turntable / control-router），每步配合补测试。TcpBridge/Udp 的真 .ts 化（带类型注解）也在本 change 完成（change 2 用 JSDoc 过渡）。

| 序号 | Change | 状态 |
|---|---|---|
| 1 | setup-ts-baseline | ✅ |
| 2 | protocol-layer-ts（JSDoc + 测试） | ✅ |
| **3a（本 change）** | **后端 TS 运行基线（tsx + 4 文件转 .ts）** | 进行中 |
| 3b | server.js 模块拆分（配合补测试） | 待启动 |
| 4 | 前端 Command.js 拆分 + TS 化 | 待启动 |
| 5 | 前端其余模块 TS 化 | 待启动 |

## Why

1. **完成 change 2 的遗留**：change 2 因"后端 node 直跑无法 require .ts"用 JSDoc 过渡，真 .ts 迁移推迟到本 change。
2. **打通后端 TS 运行链路**：有了 tsx，后续 3b 拆分、补类型注解、收 strict 才有基础。
3. **把"运行方案"这个硬约束落地**：change 1/2 一直回避后端 .ts 的运行问题，本 change 正面解决（用户已选 tsx）。

## What Changes

### 关键决策（用户已确认）
- **运行方案 = tsx**（dev 依赖，`tsx server.ts` 直接跑，esbuild 内核）。
- **最小 TS 化**：不拆模块、不改变量结构、不改 require 为 import。

### 1. 引入 tsx
- `pnpm add -D tsx`
- `package.json` 的 `dev:server` 改为 `tsx server.ts`

### 2. 四个后端文件 `.js` → `.ts`（内容逐字保留，仅必要微调）
- `config.js` → `config.ts`：require("fs") 保留；导出改 `export`（TS ESM 语法，tsx 支持）或保持 `module.exports`（tsx CJS 支持）。**采用保持 `module.exports`（CJS）**，最小改动。
- `TcpBridge.js` → `TcpBridge.ts`：保留 require + module.exports + change 2 的 JSDoc。
- `js/Udp.js` → `js/Udp.ts`：同上。
- `server.js` → `server.ts`：保留 require；**修正 require 路径**——`require("./TcpBridge.js")` → `require("./TcpBridge")`、`require("./js/Udp.js")` → `require("./js/Udp")`、`require("./config.js")` → `require("./config")`（tsx 解析 .ts）。其余逐字不变。

### 3. tsconfig 拆分（前端 ESM / 后端 CJS）
当前根 `tsconfig.json` 是 `module:ESNext / moduleResolution:Bundler`（前端 Vite 用）。后端 .ts 用 require（CJS），在 Bundler 模式下 tsc 会报 require 不可用。拆为：
- `tsconfig.json`（根，前端）：`module:ESNext`，include `*.ts`(vite/vitest config) + `tests/**/*.ts` + `js/**/*.ts`（前端协议层将来转 .ts 用，现仍 .js 不纳入）。
- `tsconfig.node.json`（后端）：`module:CommonJS / moduleResolution:Node`，include `server.ts` / `TcpBridge.ts` / `js/Udp.ts` / `config.ts`。
- `package.json` 的 `typecheck` 改为 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`（前后端各跑一次）。

### 4. 类型注解策略：最小
- 4 个后端 .ts 保留 change 2 已加的 JSDoc，**不补新类型注解**（依赖 `require` 返回 `any` + ws/serialport/exceljs 自带 .d.ts）。
- tsc 若报错，**不改业务逻辑**——优先用更精确的类型标注或 `// @ts-expect-error` 如实描述（沿用 change 2 D5 原则）。

### 不在本 change 范围
- ❌ `server.ts` 模块拆分（留 3b）
- ❌ require → import 的 ESM 改造（保持 CJS）
- ❌ 补 server.ts 业务逻辑测试（留 3b 配合拆分时补）
- ❌ 改任何业务逻辑、变量结构、调用关系
- ❌ strict 收紧（保持 false）

## Capabilities

### New Capabilities
- `backend-ts-runtime`：后端 TypeScript 运行能力——tsx 作为 .ts 运行器，server/TcpBridge/Udp/config 以 .ts 形式存在并由 tsx 执行；前后端 typecheck 分置（前端 ESM / 后端 CJS）。

### Modified Capabilities
- 无（不改动 change 1 的 `ts-engineering-baseline` capability 定义，仅在它之上扩展）。

## Impact

### 新增/修改文件
- 新增 dev 依赖：`tsx`
- `config.js` → `config.ts`（rename + 内容微调）
- `TcpBridge.js` → `TcpBridge.ts`
- `js/Udp.js` → `js/Udp.ts`
- `server.js` → `server.ts`（+ require 路径去 .js）
- `tsconfig.json` / `tsconfig.node.json`（拆分 include 与 module 设置）
- `package.json`（dev:server = tsx、typecheck = 双 tsc、新增 tsx 依赖）

### 不变
- 所有业务行为（tsx 转译等价于原 node 直跑）
- 所有业务逻辑、变量结构、调用关系
- `index.html`、`style.css`、JS 样式（全局约束）
- 遗留代码（ffmpeg 等）调用关系
- 前端代码（仍 .js）

### 验收
- `npm run typecheck` 通过（前后端双 tsc）
- `npm test` 通过（change 2 的 50 测试仍绿；注意 TcpBridge/Udp 改 .ts 后，测试 import 路径可能要调整）
- `npm run dev:server`（tsx server.ts）能启动，行为与重构前 `node server.js` **逐字一致**——人工对照（页面/WS/串口/视频/数据采集）
- 本 change 验收通过后**立即 git 提交一次**

### 风险与对策
- **风险 1**：rename `.js`→`.ts` 后 require/import 路径错乱。**对策**：tsx 支持 require 无扩展名解析 .ts；测试 import 路径同步调整；typecheck + 启动验证。
- **风险 2**：server.ts 1792 行无测试，tsx 转译后行为偏差不可见。**对策**：tsx 用 esbuild 转译（不改语义）；人工对照完整链路（页面/WS/串口/视频/Excel）作为最终验收；本 change 不改任何业务逻辑，只改扩展名/路径/类型注解。
- **风险 3**：tsc 在后端 .ts 报新类型错。**对策**：D5 原则——不改逻辑，用类型标注或 `// @ts-expect-error` 如实描述。
- **风险 4**：前端 tsconfig 改动影响 change 2 的测试。**对策**：tests/ 仍在根 tsconfig include；验证 change 2 的 50 测试仍绿。
