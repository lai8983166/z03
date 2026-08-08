## Why

前端 TS 化批 A 已完成（8 个小文件 ~2400 行）。本 change 是**第二批**，覆盖 `js/` 下 5 个中等规模文件（500-1500 行，共 ~5475 行）。完成后前端工具链覆盖到中等业务模块，剩余 change C（Video / Command 大文件）与 change D（main.js + index.html）。

## What Changes

- rename 5 个 `.js` → `.ts`：
  - `js/YC.js` (959) — 遥测数据 YC 处理 + YC 回放
  - `js/ImageUpload.js` (949) — 图像上传协议处理 + 上传回放
  - `js/DataRouter.js` (1059) — 数据链路由
  - `js/CodeUpload.js` (1153) — 代码上传协议处理
  - `js/TurntableControl.js` (1355) — 转台控制 UI + 协议
- 每个文件加完整 TS 类型：DOM narrowing、事件 payload inline interface、参数与返回值标注、class 字段
- import 路径已在前一批统一去 `.js` 后缀（验证无需再改）
- **行为逐字不变**：仅加类型 + rename；遗留代码（已注释、未启用分支）保留并 TS 化

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `frontend-modules`: 批 B 5 个文件加入"已完成"列表，更新批 A/B/C/D 进度

## Impact

- **rename**：5 个文件
- **代码**：5 个文件加类型；可能少量 import 路径调整（如批 A 改了 Client 等的导出形状）
- **配置**：`tsconfig.json` include 已含 `js/*.ts` 通配（批 A 完成），无需再改
- **构建/CI**：`npm run typecheck` 仍 0 错；`npm test` 仍 61/61 全绿
- **运行时**：零影响
- **遗留代码**：每个文件内的遗留逻辑保留并 TS 化
- **样式/HTML**：零改动
