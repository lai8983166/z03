# Design: server-modularize-ts（后端 TS 运行基线）

## Context

server.js（1792 行）是后端单体，被 change 1 的 config 化改造过（读 cfg.*），change 2 给协议层（TcpBridge/Udp）补了 JSDoc 与测试。但后端整体仍是 `.js` + `node` 直跑——change 1/2 为避免引入运行时依赖，一直回避"后端 .ts 怎么跑"。

本 change 正面解决这个硬约束：引入 tsx 让后端 .ts 可运行，并把 4 个后端文件转 .ts。**不拆模块**（server.ts 仍 1792 行单文件），模块拆分留给 3b（需先配合补测试）。

## Goals / Non-Goals

**Goals**
- 4 个后端文件（server/TcpBridge/Udp/config）转 .ts，由 tsx 运行。
- 前后端 typecheck 分置（前端 ESM / 后端 CJS），双 tsc 都通过。
- 行为绝对不变：tsx 转译等价于原 node 直跑。

**Non-Goals**
- 不拆 server.ts 模块（留 3b）。
- 不改 require 为 import（保持 CJS）。
- 不补 server.ts 业务逻辑测试（留 3b）。
- 不收紧 strict。
- 不改任何业务逻辑、变量结构、调用关系。

## Decisions

### D1. 运行方案 = tsx（用户确认）
`tsx server.ts` 直接跑 .ts（esbuild 内核，转译即跑，无 build 步骤、无 dist 双份）。tsx 作为 devDependency，生产也在 node_modules 里用它。是 TS 后端运行的事实标准。否决 `tsc build 到 dist/`（源/编译双份、需 build 步骤、工程更重）与"暂不转后端 .ts"（永远回避运行问题）。

### D2. 改用 ESM import/export（实施时调整自"保持 require"）
规划时倾向保持 CJS require。实施时发现：TS 7 + 跨 tsconfig（前端 ESNext）下，CJS `module.exports` 不被测试的 ES `import` 识别（报 "not a module"），且 `const WebSocket = require("ws")` 与 Node 全局 WebSocket 类型 redeclare。因此 4 个后端 .ts 改用 ESM `import`/`export default`/`export {}`——tsx 在 CJS 项目（package.json 无 type:module）下能跑 ESM 语法的 .ts（转译为 require）。server.ts 仅改 line 1-10 的 import 区，其余 1792 行逐字不动。

### D3. tsconfig 拆 frontend（ESM）/ node（CJS）
当前根 `tsconfig.json` 是 `module:ESNext/Bundler`（前端 Vite/vitest）。后端 `.ts` 用 require（CJS），Bundler 模式下 tsc 报 require 不可用。拆为：
- **根 `tsconfig.json`**（前端）：保持 `module:ESNext/moduleResolution:Bundler`；include 调整为 `*.ts` + `tests/**/*.ts` + `js/CommandBuilder.js` + `js/BinaryTableHelper.js`（前端协议层仍是 change 2 的 .js + JSDoc，待 change 4/5 转 .ts）。**移除** change 2 加入的 `TcpBridge.js`/`js/Udp.js`（它们转 .ts 后归后端 tsconfig）。
- **`tsconfig.node.json`**（后端）：`module:CommonJS/moduleResolution:Node`；include `server.ts`/`TcpBridge.ts`/`js/Udp.ts`/`config.ts`；`types: ["node"]`。
- **typecheck 脚本**：`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`。

### D4. require 路径去 `.js` 后缀
tsx/vite 都支持无扩展名解析（自动找 `.ts`/`.js`）。rename 后原 `require("./TcpBridge.js")` 会找不到（.js 不存在），改为 `require("./TcpBridge")`：
- `server.ts`：`./TcpBridge.js`→`./TcpBridge`、`./js/Udp.js`→`./js/Udp`、`./config.js`→`./config`
- node 内置与 npm 包（`"ws"`/`"dgram"`/`"events"`/`"fs"`/`"child_process"`/`"http"`/`"path"`/`"ws"`/`"exceljs"`/`"serialport"`）require 串不变。

### D5. @ts-nocheck 过渡（实施时调整自"类型注解最小"）
规划时设想 require 返回 any 不报。实施时发现：.ts 强制类型检查远严于 .js（checkJs:false）——class 实例属性（`this.mode` 等）未声明、`Object.entries` 推断 `unknown`、handleData 参数必填等，报数以百计类型错。本 change 聚焦"打通 tsx 运行能力"，类型收紧留 3b。因此 `server.ts`/`TcpBridge.ts`/`js/Udp.ts` 顶部加 `// @ts-nocheck`（`config.ts` 类型干净，不需要），tsc 跳过后端类型检查。typecheck 双 tsc 仍退出 0（后端跳过 + 前端/测试检查）；IDE 类型支持靠 change 2 的 JSDoc 仍有效。3b 配合模块拆分补声明时逐个移除 @ts-nocheck。

### D6. server.ts 仍单文件 1792 行（不拆）
拆分需先有 server.ts 业务逻辑的回归测试（WS handler/Excel/视频/控制路由），否则"行为不变"无法验证。补测试 + 拆分留 3b（每个职责提取一个 sub-change，配测试）。本 change 只把"后端 TS 运行链路"打通。

### D7. change 2 测试 import 路径同步调整
TcpBridge/Udp 转 .ts 后，`tests/protocol/tcp-bridge.test.ts` 的 `import TcpBridge from "../../TcpBridge.js"` 改为 `"../../TcpBridge"`；`udp-bridge.test.ts` 的 `"../../js/Udp.js"` 改为 `"../../js/Udp"`。vitest/vite 解析到 .ts。binary-table-helper/command-builder 测试不变（那两个文件仍是 .js）。

## Risks / Trade-offs

- **rename 后路径错乱** → tsx 支持无扩展名解析；typecheck + `npm run dev:server` 启动验证；change 2 的 50 测试仍绿作客观证据。
- **1792 行无测试，转译偏差不可见** → tsx 用 esbuild 转译（不改语义，只去类型注解）；本 change **不改任何业务逻辑/变量结构**，只改扩展名/路径/JSDoc；人工对照完整链路（页面/WS/串口/视频/Excel）作为最终验收。
- **tsc 报新类型错** → D5 原则，不改逻辑。
- **tsx 作为 dev 依赖但生产也用它** → 这是 TS 后端的固有代价；tsx 本身体积小（esbuild 内核），可接受；用户已确认。
- **前端 tsconfig 改动影响 change 2 测试** → 测试仍 in 根 tsconfig；rename 后 import 路径同步；50 测试全绿验证。

## Migration Plan

- 开发工具 change，无部署迁移。
- 顺序：装 tsx → 拆 tsconfig → 4 文件逐个 rename（config → TcpBridge → Udp → server，从小到大）→ 调整测试 import 路径 → 更新 dev:server/typecheck 脚本 → typecheck + test 验证 → `tsx server.ts` 人工对照 → git commit。
- 回滚：`git revert`。本 change 是 rename + 脚本调整性质，revert 后恢复 .js + node 运行。
