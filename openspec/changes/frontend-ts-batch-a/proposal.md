## Why

前端 14 个 JS 文件总计 ~14,760 行，至今仍是 `.js` + 零类型注解。本 change 是前端 TS 化的**第一批**（小文件批），覆盖 `js/` 下 8 个规模 <500 行的文件（共 ~2400 行）。批量完成后将让前端工具链（IDE hover / 重构 / 跳转 / strict 检查）覆盖到这些纯前端模块。后续 change B（中等文件）、change C（大文件 Video/Command）将继续推进，最后单独决策 main.js + index.html 的处理。

## What Changes

- rename `js/` 下 8 个 `.js` → `.ts`：
  - `js/Client.js` (179) — WS 客户端
  - `js/ImageUploadClient.js` (139) — 图像上传 WS 客户端
  - `js/StatusBar.js` (96) — 状态栏 LED 控制
  - `js/Chart.js` (449) — 图表初始化
  - `js/Infrared.js` (441) — 红外表格初始化
  - `js/Laser.js` (495) — 激光表格 + 图像
  - `js/DataHandler.js` (277) — 数据路由分发
  - `js/Telemeter.js` (309) — 遥测数据处理
- 每个文件加完整 TS 类型：DOM 操作（document.getElementById 等）用 narrowing；class/函数参数/返回值标注；事件 payload 用 inline interface 或 union
- 更新 import 路径（去 `.js` 后缀，让 vite/tsx 自动解析 .ts 与剩余 .js）：
  - 8 个文件相互引用
  - 其他文件（main.js、js/Command.js、js/Video.js、js/YC.js、js/ImageUpload.js 等）引用这 8 个的路径
- tsconfig.json include 调整：加 `js/*.ts` 通配（或显式列 8 个文件）
- **不**改 main.js（保留 .js）；**不**改 index.html
- **行为逐字不变**：仅加类型 + rename + import 路径

## Capabilities

### New Capabilities

- `frontend-modules`: 前端业务模块（按文件粒度）的 TS 化与类型契约。本 change 建立并迁移 8 个小文件；后续 change B/C 继续迁移中等与大文件。

### Modified Capabilities

（无——本 change 不修改已有 capability 的 requirement；前端模块化是新 capability）

## Impact

- **rename**：8 个文件
- **代码**：8 个文件加类型；约 10+ 个其他文件（含 .js 与本 change 外的 .ts）更新 import 路径
- **配置**：`tsconfig.json` include 加 `js/*.ts` 或显式列
- **构建/CI**：`npm run typecheck` 仍 0 错；`npm test` 仍 61/61 全绿
- **运行时**：零影响（类型擦除 + import 路径等价）
- **遗留代码**：每个文件内的遗留逻辑（如已注释代码、未启用分支）保留并 TS 化，调用关系不变
- **样式/HTML**：零改动（约束）；不动 index.html、style.css、JS 样式代码
