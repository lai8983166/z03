## Why

前端 TS 化批 A（8 小）+ 批 B（5 中等）已完成。本 change 是**最后一批业务模块**，覆盖 2 个大文件（共 ~6361 行）：
- `js/Video.js` (1804) — RTSP/红外视频流处理 + 二值化 + 视频回放
- `js/Command.js` (4557) — 协议命令构造与处理（最大最复杂）

完成后全前端业务模块 TS 化（不含 main.js 与 index.html，留批 D 单独决策）。

## What Changes

- rename 2 个 `.js` → `.ts`
- 每个文件加完整 TS 类型：DOM narrowing、函数参数与返回值、事件 payload、interface
- **行为逐字不变**（不修业务 bug，与 CodeUpload.ts 的 `==` 修复不同——本次仅类型化）
- import 路径已统一无 `.js` 后缀（前几批完成），无需再改

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `frontend-modules`: 批 C 2 个文件加入"已完成"；批 A/B/C 共 15 个文件全 TS 化（仅剩 main.js + index.html 留批 D）

## Impact

- **rename**：2 个文件
- **代码**：2 个文件加类型；可能少量跨文件 import 推断调整
- **配置**：tsconfig 已含 `js/*.ts` 通配
- **构建/CI**：`npm run typecheck` 仍 0 错；`npm test` 仍 61/61
- **运行时**：零影响
- **遗留**：每个文件内的遗留逻辑保留并 TS 化
- **样式/HTML**：零改动
