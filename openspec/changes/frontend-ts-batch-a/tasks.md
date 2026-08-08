# Tasks: frontend-ts-batch-a（8 个小前端 JS → TS）

> 全局约定：每个 change 一个 git commit；测试一律 mock；不改 index.html/style.css/JS 样式代码；遗留代码保留且不接入。本 change 是前端 TS 化第一批（小文件批）。设计依据：design.md D1-D7。

## 1. 准备与盘点（skill: eric-quality-control）

- [x] 1.1 `npm run typecheck` 确认基线 0 错
- [x] 1.2 `npm test` 确认基线 61/61
- [x] 1.3 grep 复核 8 个文件的被引用关系（哪些文件 import 它们），形成清单

## 2. 批量 rename（skill: eric-javascript）

- [x] 2.1 `git mv` 8 个 `.js` → `.ts`：Client / ImageUploadClient / StatusBar / Chart / Infrared / Laser / DataHandler / Telemeter
- [x] 2.2 `tsconfig.json` include 加 `js/*.ts` 通配（或显式列 8 个文件）

## 3. 全项目 import 路径更新（skill: eric-javascript）

- [x] 3.1 sed 批量：全项目 `from "./X.js"` → `from "./X"`（仅相对路径，不动 node_modules）
- [x] 3.2 grep 复核：无 `from ".*Client\.js"` / `".*StatusBar\.js"` / `".*Chart\.js"` / `".*Infrared\.js"` / `".*Laser\.js"` / `".*DataHandler\.js"` / `".*Telemeter\.js"` 残留
- [x] 3.3 跑 typecheck 看 import 解析是否正常（暂不修类型错，仅看 import 错）

## 4. 逐文件类型化（skill: eric-backend + eric-frontend 如有）

按依赖顺序（先底层后上层）：
- [x] 4.1 `StatusBar.ts`（96 行，无 import 依赖，最底层）
- [x] 4.2 `ImageUploadClient.ts`（139 行，无 import）
- [x] 4.3 `Client.ts`（179 行，依赖 DataHandler/Video/Telemeter/YC）
- [x] 4.4 `DataHandler.ts`（277 行，依赖 Command/ImageUpload）
- [x] 4.5 `Telemeter.ts`（309 行，依赖 Laser/Video/PacketManager）
- [x] 4.6 `Infrared.ts`（441 行，依赖 main.js/Client/StatusBar/Video）
- [x] 4.7 `Laser.ts`（495 行，依赖 main.js/Client/StatusBar）
- [x] 4.8 `Chart.ts`（449 行，依赖 echarts）

每文件：
- DOM 操作加 narrowing（D3）
- 事件 payload 用 inline 类型或 unknown（D4）
- 第三方库（echarts）类型评估（D5）
- 跑 typecheck 看新错，逐个修

## 5. 全量验证（skill: eric-quality-control）

- [x] 5.1 `npm run typecheck` 通过（strict 全开，0 错）
- [x] 5.2 `npm test` 通过（61/61 全绿）
- [x] 5.3 grep 复核：8 个文件无 `@ts-nocheck`；新增 `@ts-expect-error` 仅个位数 + 每处注明原因；`as any` 0 处
- [x] 5.4 `git diff` 复核：去掉类型标注后可执行代码逐字一致；样式代码（element.style / className 等）完全不动
- [x] 5.5 复核约束：index.html / style.css 未动；测试断言未改

## 6. eric-review + 提交（skill: eric-review）

- [x] 6.1 eric-review 自查（重点：DOM narrowing 不破坏运行时假设、import 路径全项目清理、样式代码完全不动、遗留代码保留）
- [x] 6.2 `git commit`（含 rename + 类型 + import 路径 + tsconfig）
- [x] 6.3 `git push`
