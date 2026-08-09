## Why

当前 61 个测试覆盖协议层 + 后端纯函数，但**业务核心路由层零覆盖**：
- 后端 `control.ts`（消息路由 23 case）—— 决定前端消息如何分发到 data/turntable/video
- 前端 `DataHandler.ts`（rs485 flag 路由 38 case）—— 决定协议解析后调用哪个业务 handler

路由错位（如 START_SAVE_VIDEO 调成 startSavingJG）是高风险 bug，目前完全靠人工联调发现。补路由测试能在编译期外多一道保险。

## What Changes

- 新增 `tests/control.test.ts`：
  - 测 `handleControlCommand` 14 个 action case（START/STOP_SAVE_*、START/STOP_BINARIZED_STREAM、SEND_TO_BRIDGE2 + 无 data 边界 + default）
  - 测 `handleJsonControlMessage` 9 个 type case（ping/SET_TURNTABLE_PORT 含空 port 分支/REQUEST_SAVE_PATH 含各 saveType 分支/CONTROL_CMD/SAVE_B/A_FRAME_ROW/HEIXIAZI_EXCEL_HEADER/SAVE_HEIXIAZI_EXCEL_ROW/BINARIZED_PARAMS 含 needRestart 分支/default）
- 新增 `tests/data-handler.test.ts`：
  - 测 `handleRS485` 主要 case（0/1/2/3/5/9/10/15/16/17/19/20/21/22/23/24/25/27/30/40/41/42/44 + default + 含 data[0] 分支的 case）
- 测试策略：
  - control：mock opts（data/video/turntable/binarized/wsBus），构造 msg，验证 mock 方法被调用
  - DataHandler：vi.mock 替换 Command/ImageUpload/CodeUpload/DataRouter/Telemeter 的 handler 导出，构造 (flag, name, data)，验证对应 mock 被调用

## Capabilities

### New Capabilities
（无——测试是 protocol-regression-tests / ts-engineering-baseline 已描述"测试覆盖"的扩展）

### Modified Capabilities
- `protocol-regression-tests`: "协议层纯逻辑测试覆盖" requirement 扩展覆盖范围——加入 DataHandler.handleRS485 路由测试
- `backend-ts-runtime`（隐含）：control 模块路由的正确性现在有单测兜底

## Impact

- **新增测试**：~50-60 个（control ~30 + DataHandler ~20-30）
- **代码**：不改动业务代码（仅加测试文件）
- **构建/CI**：`npm test` 从 61 增至 ~110-120；typecheck 0 错
- **运行时**：零影响
- **mock 策略**：所有外部依赖（data/video/turntable/binarized/wsBus/handler imports）mock；不接触真实端口/IP/串口/DOM
