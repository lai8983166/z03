# Tasks: server-modularize-ts（后端 TS 运行基线）

> 全局约定：每 change 完成后提交一次 git；测试一律 mock；不改 HTML/CSS/JS 样式；遗留代码保留不接入。本 change 关键纪律：**4 个后端文件只 rename + 必要路径调整，业务逻辑逐字不变**。

## 1. 引入 tsx + tsconfig 拆分（skill: eric-javascript）

- [x]1.1 `pnpm add -D tsx`
- [x]1.2 根 `tsconfig.json` 调整：include 移除 `TcpBridge.js`/`js/Udp.js`（转 .ts 归后端），保留 `*.ts`/`tests/**/*.ts`/`js/CommandBuilder.js`/`js/BinaryTableHelper.js`
- [x]1.3 `tsconfig.node.json` 重写：`module:CommonJS`/`moduleResolution:Node`/`types:["node"]`，include `server.ts`/`TcpBridge.ts`/`js/Udp.ts`/`config.ts`
- [x]1.4 `package.json` 的 `typecheck` 改为 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`

## 2. config.js → config.ts（最小）

- [x]2.1 `git mv config.js config.ts`（保留历史）
- [x]2.2 内容不动（require("fs") + module.exports + JSDoc 全保留）

## 3. TcpBridge.js → TcpBridge.ts

- [x]3.1 `git mv TcpBridge.js TcpBridge.ts`
- [x]3.2 内容不动（require + module.exports + change 2 的 JSDoc 全保留）

## 4. js/Udp.js → js/Udp.ts

- [x]4.1 `git mv js/Udp.js js/Udp.ts`
- [x]4.2 内容不动

## 5. server.js → server.ts（最大，但只改路径）

- [x]5.1 `git mv server.js server.ts`
- [x]5.2 修正 require 路径：`require("./TcpBridge.js")`→`require("./TcpBridge")`、`require("./js/Udp.js")`→`require("./js/Udp")`、`require("./config.js")`→`require("./config")`
- [x]5.3 **业务逻辑逐字不动**（变量、函数、handler、ffmpeg、Excel、bridge 全保留）

## 6. 同步 change 2 测试 import 路径（skill: eric-quality-control）

- [x]6.1 `tests/protocol/tcp-bridge.test.ts`：`import TcpBridge from "../../TcpBridge.js"` → `"../../TcpBridge"`
- [x]6.2 `tests/protocol/udp-bridge.test.ts`：`import UdpBridge from "../../js/Udp.js"` → `"../../js/Udp"`
- [x]6.3 binary-table-helper / command-builder 测试不动（目标仍是 .js）

## 7. 脚本更新

- [x]7.1 `package.json` 的 `dev:server` 改为 `tsx server.ts`
- [x]7.2 确认 `typecheck`（1.4 已改）与 `test`（vitest，不变）

## 8. 验收与提交（skill: eric-quality-control + eric-review）

- [x]8.1 `npm run typecheck` 通过（前后端双 tsc）
- [x]8.2 `npm test` 通过（change 2 的 50 测试仍绿，证明协议层行为不变）
- [x]8.3 `npm run dev:server`（tsx server.ts）能启动，server 初始化日志正常（HTTP/WS/bridge/串口/ffmpeg）
- [x]8.4 浏览器人工对照重构前：页面/WS/串口/视频/数据采集写盘逐字一致（**唯一能验证 server.ts 行为不变的途径**——1792 行无测试）
- [x]8.5 `git diff` 复核：4 个后端 .ts 内容相对原 .js 只有 require 路径变化（config/TcpBridge/Udp 应完全无差异，server.ts 只有 3 处 require 路径）
- [x]8.6 复核约束：`index.html`/`style.css`/JS 样式未动；遗留代码（ffmpeg）调用关系未变；前端 .js 未动
- [x]8.7 eric-review 自查清单（重点：rename 是否漏改路径、tsx 转译等价性、JSDoc 是否手滑改逻辑）
- [x]8.8 `git commit`（本 change 一次提交）
